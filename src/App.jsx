import React, { useState, useEffect } from 'react';
import './App.css';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { useRef } from 'react';

// --- FORMATTING & MATH TOOLS ---
const roundMath = (num) => Math.round((Number(num) || 0) * 100) / 100;
const formatINR = (value) => Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const formatCount = (value) => Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

const enforceTwoDecimals = (value) => {
  if (!value) return '';
  let val = value.toString().replace(/,/g, '').replace(/[^0-9.]/g, ''); 
  const parts = val.split('.');
  if (parts.length > 2) val = parts[0] + '.' + parts.slice(1).join(''); 
  if (val.includes('.')) {
    const [whole, decimal] = val.split('.');
    val = `${whole}.${decimal.substring(0, 2)}`;
  }
  return val;
};

const formatInputINR = (val) => {
  if (val === '') return '';
  const parts = val.toString().split('.');
  let whole = parts[0] ? Number(parts[0]).toLocaleString('en-IN') : '0';
  return parts.length > 1 ? `${whole}.${parts[1]}` : whole;
};

const formatDateToDDMMYYYY = (dateString) => {
  if (!dateString) return '';
  const [year, month, day] = dateString.split('-');
  return `${day}-${month}-${year}`;
};

const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzmUqetXbMjGFnceLbhd4KmYoNce3EoN1tG7XGYPedZp0URHp2bZfCf3i7UHhisIWmKNQ/exec";

export default function App() {
  const printRef = useRef(null);

  // --- CONTROL PANEL STATE ---
  const [invoiceNo, setInvoiceNo] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [batch, setBatch] = useState('Batch 1');
  const [batchOptions, setBatchOptions] = useState([]); 
  const [client, setClient] = useState('');
  const [clientsDb, setClientsDb] = useState([]);
  
  // --- CLIENT MODAL STATES ---
  const [showAddClientModal, setShowAddClientModal] = useState(false);
  const [showEditClientModal, setShowEditClientModal] = useState(false);
  const [newClientData, setNewClientData] = useState({ name: '', phone: '', address: '', notes: '' });
  const [editClientData, setEditClientData] = useState({ name: '', phone: '', address: '', notes: '' });

  // --- POPOVER STATE ---
  const [showAddFunds, setShowAddFunds] = useState(false);
  const [popoverMode, setPopoverMode] = useState('advance'); 
  const [fundsToAdd, setFundsToAdd] = useState('');
  const [advancePayMode, setAdvancePayMode] = useState('Cash');
  const [advanceNo, setAdvanceNo] = useState('');
  const [nextGlobalInvoice, setNextGlobalInvoice] = useState(''); 

  // --- SEARCH, LOCK & HISTORICAL STATE ---
  const [isViewingPast, setIsViewingPast] = useState(false);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [historicalLedger, setHistoricalLedger] = useState(null); 
  const [showPinPrompt, setShowPinPrompt] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const ADMIN_PIN = "1234"; 
  
  const [isInvoiceDropdown, setIsInvoiceDropdown] = useState(false);
  const [availableInvoices, setAvailableInvoices] = useState([]);

  // --- INVENTORY TABLE STATE ---
  const [items, setItems] = useState([{ id: Date.now(), desc: '', qty: 0, unit: 'Trays', price: 0, discount: 0, subtotal: 0, totalCount: 0 }]);

  // --- LIVE LEDGER STATE ---
  const [paidAmount, setPaidAmount] = useState(''); 
  const [advanceApplied, setAdvanceApplied] = useState('');
  const [paymentMode, setPaymentMode] = useState('Cash');
  const [checkNumber, setCheckNumber] = useState('');

  // --- DATA FETCHING ---
  const fetchInitialData = async () => {
    try {
      const response = await fetch(SCRIPT_URL, {
        method: 'POST',
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        redirect: "follow",
        body: JSON.stringify({ action: 'getInitialData' }),
      });
      const data = await response.json();
      
      if (data.clients) setClientsDb(data.clients);
      
      if (data.batches) {
        setBatchOptions(data.batches);
        if (!isViewingPast && !batch) setBatch(data.batches[0]); 
      }
      
      if (data.nextInvoice && !isViewingPast) {
        setInvoiceNo(data.nextInvoice);
        setNextGlobalInvoice(data.nextInvoice);
      }
      if (data.nextAdvance) setAdvanceNo(data.nextAdvance);
    } catch (error) {
      alert("Failed to connect to the database.");
    }
  };

  useEffect(() => {
    fetchInitialData();
  }, []); 

  // --- LOGIC CALCULATIONS ---
  const grandTotal = items.reduce((sum, item) => sum + item.subtotal, 0);
  const selectedClientData = clientsDb.find(c => c.name === client);
  const currentAdvance = selectedClientData ? selectedClientData.advance : 0;
  const currentPending = selectedClientData ? selectedClientData.pending : 0; 
  
  const numericPaidAmount = parseFloat(paidAmount) || 0;
  const numericAdvanceApplied = parseFloat(advanceApplied) || 0;
  const totalDeductions = numericPaidAmount + numericAdvanceApplied;
  const balanceDue = Math.max(0, grandTotal - totalDeductions);

  let derivedStatus = 'Pending';
  if (totalDeductions > 0) {
    if (totalDeductions >= grandTotal) derivedStatus = 'Paid';
    else derivedStatus = 'Partial';
  }

  // --- CLIENT HANDLERS ---
  const handleAddClientSubmit = async () => {
    if (!newClientData.name.trim() || !newClientData.phone.trim() || !newClientData.address.trim()) {
      alert("Error: Client Name, Phone, and Address are strictly required!");
      return;
    }
    try {
      const payload = { action: 'addClient', name: newClientData.name.trim(), phone: newClientData.phone.trim(), address: newClientData.address.trim(), notes: newClientData.notes.trim() };
      const response = await fetch(SCRIPT_URL, { 
        method: 'POST', 
        headers: { "Content-Type": "text/plain;charset=utf-8" }, 
        redirect: "follow", 
        body: JSON.stringify(payload) 
      });
      const result = await response.json();
      if (result.success) {
        alert(`Success! ${newClientData.name} has been added to your Clients database.`);
        await fetchInitialData(); 
        setClient(newClientData.name.trim()); 
        setShowAddClientModal(false);
        setNewClientData({ name: '', phone: '', address: '', notes: '' }); 
      } else alert(`Failed: ${result.message}`);
    } catch (error) { alert("Connection error. Could not add client."); }
  };

  const handleEditClientSubmit = async () => {
    if (!editClientData.phone.trim() || !editClientData.address.trim()) {
      alert("Error: Phone and Address are strictly required!");
      return;
    }
    try {
      const payload = { action: 'editClient', name: editClientData.name, phone: editClientData.phone.trim(), address: editClientData.address.trim(), notes: editClientData.notes.trim() };
      const response = await fetch(SCRIPT_URL, { 
        method: 'POST', 
        headers: { "Content-Type": "text/plain;charset=utf-8" }, 
        redirect: "follow", 
        body: JSON.stringify(payload) 
      });
      const result = await response.json();
      if (result.success) {
        alert(`Success! ${editClientData.name}'s profile has been updated.`);
        await fetchInitialData(); 
        setShowEditClientModal(false);
      } else alert(`Failed: ${result.message}`);
    } catch (error) { alert("Connection error. Could not update client."); }
  };

  // --- BATCH HANDLER ---
  const handleBatchChange = (e) => {
    const val = e.target.value;
    if (val === 'NEW') {
      const newBatch = window.prompt("Enter the name for the new batch (e.g., Batch 2, Summer Flock):");
      if (newBatch && newBatch.trim() !== '') {
        const cleanBatch = newBatch.trim();
        if (!batchOptions.includes(cleanBatch)) setBatchOptions([...batchOptions, cleanBatch]);
        setBatch(cleanBatch);
      }
    } else setBatch(val);
  };

  // --- SMART SEARCH PARSER ---
  const formatSearchQuery = (query) => {
    let clean = query.toString().toUpperCase().trim();
    if (clean.includes('-')) {
      let parts = clean.replace('INV-', '').split('-');
      if (parts.length === 2) {
        let yyMM = parts[0].replace(/[^0-9]/g, '');
        let seq = parts[1].replace(/[^0-9]/g, '').padStart(3, '0');
        return `INV-${yyMM}-${seq}`;
      }
    }
    let digits = clean.replace(/[^0-9]/g, '');
    const d = new Date();
    const yy = d.getFullYear().toString().slice(-2);
    const currMM = ('0' + (d.getMonth() + 1)).slice(-2);

    if (digits.length <= 3) return `INV-${yy}${currMM}-${digits.padStart(3, '0')}`;
    else if (digits.length === 4) return `INV-${yy}${digits.slice(0, 1).padStart(2, '0')}-${digits.slice(1).padStart(3, '0')}`;
    else if (digits.length === 5) return `INV-${yy}${digits.slice(0, 2)}-${digits.slice(2).padStart(3, '0')}`;
    else if (digits.length >= 6) return `INV-${digits.slice(0, 4)}-${digits.slice(4).padStart(3, '0')}`;
    return clean;
  };

  // --- DATABASE SEARCH HANDLERS ---
  const executeSearch = async (type, query) => {
    try {
      const response = await fetch(SCRIPT_URL, {
        method: 'POST',
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        redirect: "follow",
        body: JSON.stringify({ action: 'searchInvoice', type: type, query: query })
      });
      const data = await response.json();
      
      if (data.success && data.results && data.results.length > 0) {
        if (data.results.length === 1) populateDashboard(data.results[0]);
        else if (type === 'Date') {
          setAvailableInvoices(data.results);
          setIsInvoiceDropdown(true);
          setInvoiceNo(''); 
        }
      } else {
        if (type === 'Invoice No') alert(`No invoices found for: ${query}`);
        else setIsInvoiceDropdown(false); 
      }
    } catch (error) { alert("Search failed. Check your internet or ensure backend is updated."); }
  };

  const handleInvoiceSearch = () => {
    if (!invoiceNo) return;
    const finalQuery = formatSearchQuery(invoiceNo);
    setInvoiceNo(finalQuery); 
    executeSearch('Invoice No', finalQuery);
  };

  const handleDateChange = (e) => {
    const selectedDate = e.target.value;
    setDate(selectedDate);
    executeSearch('Date', selectedDate); 
  };

  const handleInvoiceDropdownSelect = (e) => {
    const val = e.target.value;
    if (val === 'NEW') {
      setIsInvoiceDropdown(false);
      handleClearSearch(); 
      setDate(date); 
    } else if (val) {
      const selected = availableInvoices.find(inv => inv.invoiceNo === val);
      if (selected) populateDashboard(selected);
    }
  };

  const populateDashboard = (invoiceData) => {
    setInvoiceNo(invoiceData.invoiceNo);
    setDate(invoiceData.date || new Date().toISOString().split('T')[0]);
    setClient(invoiceData.client || '');
    
    const loadedBatch = invoiceData.batch || 'Batch 1';
    setBatch(loadedBatch);
    setBatchOptions(prev => prev.includes(loadedBatch) ? prev : [...prev, loadedBatch]);
    
    setHistoricalLedger({
      grandTotal: invoiceData.grandTotal,
      paidStr: invoiceData.paid,
      balance: invoiceData.balance,
      status: invoiceData.status
    });

    if (invoiceData.rawItems) setItems(JSON.parse(invoiceData.rawItems));
    else setItems([{ id: Date.now(), desc: 'Past Item', qty: 0, unit: 'Trays', price: 0, discount: 0, subtotal: invoiceData.grandTotal || 0, totalCount: 0 }]);

    if (invoiceData.rawDetails) {
      const details = JSON.parse(invoiceData.rawDetails);
      setPaidAmount(details.paidAmount || '');
      setAdvanceApplied(details.advanceApplied || '');
      setPaymentMode(details.paymentMode || 'Cash');
      setCheckNumber(details.checkNumber || '');
    } else {
      setPaidAmount(''); 
      setAdvanceApplied(invoiceData.advanceUsed || '');
      setPaymentMode(invoiceData.payMode || 'Cash');
    }

    setIsViewingPast(true);
    setIsUnlocked(false);
    setIsInvoiceDropdown(false);
  };

  const handleUnlockSubmit = () => {
    if (pinInput === ADMIN_PIN) {
      setIsUnlocked(true);
      setShowPinPrompt(false);
      setPinInput('');
    } else {
      alert("Incorrect PIN. Access Denied.");
      setPinInput('');
    }
  };

  const handleClearSearch = () => {
    setClient('');
    setPaidAmount('');
    setAdvanceApplied('');
    setPaymentMode('Cash');
    setCheckNumber('');
    setItems([{ id: Date.now(), desc: '', qty: 0, unit: 'Trays', price: 0, discount: 0, subtotal: 0, totalCount: 0 }]);
    
    setIsViewingPast(false);
    setIsUnlocked(false);
    setHistoricalLedger(null); 
    setIsInvoiceDropdown(false);
    setDate(new Date().toISOString().split('T')[0]); 
    setInvoiceNo(nextGlobalInvoice); 
    
    if (batchOptions.length > 0) setBatch(batchOptions[0]);
  };

  // --- POPOVER HANDLERS ---
  const handleAddFunds = async () => {
    const num = parseFloat(fundsToAdd) || 0;
    if (num > 0 && client && advanceNo) {
      const payload = { action: 'logAdvance', date: new Date().toISOString().split('T')[0], advNo: advanceNo, client: client, amount: num, payMode: advancePayMode };
      try {
        const response = await fetch(SCRIPT_URL, { 
          method: 'POST', 
          headers: { "Content-Type": "text/plain;charset=utf-8" }, 
          redirect: "follow", 
          body: JSON.stringify(payload) 
        });
        const result = await response.json();
        if (result.success) {
          alert(`Success! Advance ${advanceNo} for ₹${formatINR(num)} added to the Ledger.`);
          fetchInitialData(); 
        }
      } catch (error) { alert("Connection error."); }
    }
    setShowAddFunds(false);
    setFundsToAdd('');
    setAdvancePayMode('Cash'); 
  };

  const handlePayDebt = async () => {
    const num = parseFloat(fundsToAdd) || 0;
    if (num > 0 && client) {
      const payload = { action: 'payDebt', date: new Date().toISOString().split('T')[0], client: client, amount: num, payMode: advancePayMode, advNo: advanceNo };
      try {
        const response = await fetch(SCRIPT_URL, { 
          method: 'POST', 
          headers: { "Content-Type": "text/plain;charset=utf-8" }, 
          redirect: "follow", 
          body: JSON.stringify(payload) 
        });
        const result = await response.json();
        if (result.success) {
          let msg = `Success! Applied ₹${formatINR(result.paidToDebt)} to Pending Invoices.`;
          if (result.remaining > 0 && advancePayMode !== 'Apply Advance') msg += `\nSurplus of ₹${formatINR(result.remaining)} automatically added to Advance Balance!`;
          alert(msg);
          fetchInitialData(); 
        } else {
          alert(result.message); 
        }
      } catch (error) { alert("Connection error."); }
    }
    setShowAddFunds(false);
    setFundsToAdd('');
    setAdvancePayMode('Cash'); 
  };

  const handleFundsInputChange = (e) => setFundsToAdd(enforceTwoDecimals(e.target.value));

  const handleInputChange = (id, field, value) => {
    const newItems = items.map(item => {
      if (item.id === id) {
        let safeValue = value;
        if (field === 'qty' || field === 'price' || field === 'discount') safeValue = enforceTwoDecimals(value);
        
        const updatedItem = { ...item, [field]: safeValue };
        const qtyNum = parseFloat(updatedItem.qty) || 0;
        const priceNum = parseFloat(updatedItem.price) || 0;
        const discountNum = parseFloat(updatedItem.discount) || 0;
        const multiplier = (updatedItem.unit === 'Trays') ? 30 : 1;
        
        updatedItem.totalCount = roundMath(qtyNum * multiplier);
        updatedItem.subtotal = roundMath(updatedItem.totalCount * (priceNum - discountNum));
        
        return updatedItem;
      }
      return item;
    });
    setItems(newItems);
  };

  const handleAmountPaidChange = (e) => {
    let safeVal = enforceTwoDecimals(e.target.value);
    if (safeVal === '') { setPaidAmount(''); return; }
    const numVal = parseFloat(safeVal) || 0;
    const maxApplicable = roundMath(grandTotal - (parseFloat(advanceApplied) || 0));
    if (numVal > maxApplicable) safeVal = maxApplicable.toString();
    setPaidAmount(safeVal);
  };

  const handleAdvanceAppliedChange = (e) => {
    let safeVal = enforceTwoDecimals(e.target.value);
    if (safeVal === '') { setAdvanceApplied(''); return; }
    const numVal = parseFloat(safeVal) || 0;
    const maxApplicable = Math.min(currentAdvance, roundMath(grandTotal - (parseFloat(paidAmount) || 0)));
    if (numVal > maxApplicable) safeVal = maxApplicable.toString();
    setAdvanceApplied(safeVal);
  };

  const addRow = () => setItems([...items, { id: Date.now(), desc: '', qty: 0, unit: 'Trays', price: 0, discount: 0, subtotal: 0, totalCount: 0 }]);
  const removeRow = (id) => { if (items.length > 1) setItems(items.filter(item => item.id !== id)); };

  const resetDashboardAfterSave = () => {
    handleClearSearch(); 
    fetchInitialData(); 
  };

  // --- SUBMISSION ACTIONS ---
  const submitInvoiceData = async () => {
    const validItems = items.filter(i => parseFloat(i.qty) > 0);
    if (validItems.length === 0) {
      alert("Error: Cannot save an empty invoice. Please enter a quantity for at least one item.");
      return false;
    }

    const itemsSummary = validItems.map(i => {
      const priceUnit = i.unit === 'Trays' ? 'Egg' : i.unit;
      return `${i.qty} ${i.unit} - ${i.desc || 'Item'} @ ₹${i.price}/${priceUnit} (Disc: ₹${i.discount})`;
    }).join(' | ');

    const finalPaymentMode = paymentMode === 'Cheque' && checkNumber ? `Cheque (No. ${checkNumber})` : paymentMode;
    const totalTrays = validItems.filter(i => i.unit === 'Trays').reduce((sum, i) => sum + (parseFloat(i.qty) || 0), 0);
    const totalBirds = validItems.filter(i => i.unit === 'Birds').reduce((sum, i) => sum + (parseFloat(i.qty) || 0), 0);
    const totalEggs = validItems.filter(i => i.unit === 'Trays').reduce((sum, i) => sum + ((parseFloat(i.qty) || 0) * 30), 0);
    const formatINR = (val) => Number(val).toLocaleString('en-IN');

    let formattedPaidColumn = `₹${formatINR(numericPaidAmount)}`; 
    if (numericAdvanceApplied > 0) {
      const totalCombinedPayment = numericAdvanceApplied + numericPaidAmount;
      formattedPaidColumn = `(ADV ₹${formatINR(numericAdvanceApplied)}) + ₹${formatINR(numericPaidAmount)} = ₹${formatINR(totalCombinedPayment)}`;
    }

    const payload = {
      action: 'saveInvoice', invoiceNo, date, batch, client,
      totalTrays, totalEggs, totalBirds, grandTotal,
      paid: formattedPaidColumn, advanceUsed: numericAdvanceApplied,
      balance: balanceDue, status: derivedStatus, items: itemsSummary,
      payMode: finalPaymentMode, ledgerEntry: "Sale", 
      isUpdate: isViewingPast && isUnlocked,
      rawItems: JSON.stringify(validItems),
      rawDetails: JSON.stringify({ paidAmount, advanceApplied, paymentMode, checkNumber })
    };

    try {
      const response = await fetch(SCRIPT_URL, { 
        method: 'POST', 
        headers: { "Content-Type": "text/plain;charset=utf-8" }, 
        redirect: "follow", 
        body: JSON.stringify(payload) 
      });
      const result = await response.json();
      if (!result.success) alert(`Save failed: ${result.message}`);
      return result.success; 
    } catch (error) {
      alert("Connection error. Could not save to database.");
      return false;
    }
  };

  const handleSaveOnly = async () => {
    const isSaved = await submitInvoiceData();
    if (isSaved) {
      alert(`Success! Invoice ${invoiceNo} has been saved.`);
      resetDashboardAfterSave(); 
    }
  };

  const generatePDFDocument = async () => {
    const wrapper = printRef.current;
    if (!wrapper) return false;

    const pageElements = wrapper.querySelectorAll('.print-page');
    if (pageElements.length === 0) return false;

    try {
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();

      for (let i = 0; i < pageElements.length; i++) {
        const canvas = await html2canvas(pageElements[i], { scale: 2, useCORS: true, backgroundColor: "#ffffff", logging: false });
        const imgData = canvas.toDataURL('image/jpeg', 0.75);
        if (i > 0) pdf.addPage(); 
        pdf.addImage(imgData, 'JPEG', 0, 0, pdfWidth, pdfHeight, undefined, 'FAST');
      }
      
      pdf.save(`UrbanEggs_Invoice_${invoiceNo}.pdf`);
      return true;
    } catch (error) {
      alert("PDF generation failed.");
      return false;
    }
  };

  const handleGeneratePDF = async () => {
    const isSaved = await submitInvoiceData();
    if (!isSaved) return; 
    await new Promise((resolve) => setTimeout(resolve, 750)); 
    await generatePDFDocument();
    resetDashboardAfterSave(); 
  };

  const handleReprintOnly = async () => {
    await new Promise((resolve) => setTimeout(resolve, 750)); 
    await generatePDFDocument();
  };

  // --- PAGINATION LOGIC ---
  const PAGE_1_MAX = 9;
  const PAGE_2_MAX = 12;

  const validItemsToPrint = items.filter(item => parseFloat(item.qty) > 0);
  if (validItemsToPrint.length === 0) {
    validItemsToPrint.push({ id: 'blank', desc: '', qty: 0, unit: 'Trays', price: 0, discount: 0, subtotal: 0, totalCount: 0 });
  }

  const paginatedItems = [];
  if (validItemsToPrint.length <= PAGE_1_MAX) {
    paginatedItems.push(validItemsToPrint); 
  } else {
    paginatedItems.push(validItemsToPrint.slice(0, PAGE_1_MAX));
    let remainingItems = validItemsToPrint.slice(PAGE_1_MAX);
    while (remainingItems.length > 0) {
      paginatedItems.push(remainingItems.slice(0, PAGE_2_MAX));
      remainingItems = remainingItems.slice(PAGE_2_MAX);
    }
  }

  return (
    <div className="dashboard-container">
      <img src="/letterhead.png" alt="preload" style={{ display: 'none' }} />
      
      <div className="header">
        <img src="/logo.png" alt="Urban Eggs Logo" className="header-logo" onClick={() => window.location.reload()} style={{ cursor: 'pointer' }} title="Refresh Dashboard" />
        <h1>Urban Eggs - Dashboard</h1>
        <div className="header-spacer"></div>
      </div>

      <div className="meta-grid">
        <div className="form-group">
          <label>
            Invoice Number 
            <span style={{fontWeight: 'normal', fontSize: '11px', color: '#666', marginLeft: '5px'}}>
              (Press Enter to Search)
            </span>
          </label>
          <div style={{ display: 'flex', gap: '5px' }}>
            {isInvoiceDropdown ? (
              <select className="smart-field" value={invoiceNo} onChange={handleInvoiceDropdownSelect} style={{ flex: 1 }}>
                <option value="">-- Select Invoice --</option>
                {availableInvoices.map(inv => (
                  <option key={inv.invoiceNo} value={inv.invoiceNo}>{inv.invoiceNo} - {inv.client}</option>
                ))}
                <option value="NEW">➕ Create New Invoice</option>
              </select>
            ) : (
              <>
                <input 
                  type="text" 
                  className="smart-field" 
                  value={invoiceNo} 
                  onChange={(e) => setInvoiceNo(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleInvoiceSearch()}
                  disabled={isViewingPast && !isUnlocked} 
                  style={{ flex: 1 }}
                />
                <button 
                  onClick={handleInvoiceSearch}
                  disabled={isViewingPast && !isUnlocked}
                  title="Search by Invoice Number"
                  style={{ padding: '0 12px', border: '1px solid #ffcc00', borderRadius: '4px', background: '#fff9e6', cursor: 'pointer', fontSize: '18px' }}
                >
                  🔍
                </button>
              </>
            )}
          </div>
        </div>
        <div className="form-group">
          <label>Date</label>
          <input type="date" value={date} onChange={handleDateChange} disabled={isViewingPast && !isUnlocked} />
        </div>
        <div className="form-group">
          <label>Batch Number</label>
          <select value={batch} onChange={handleBatchChange} disabled={isViewingPast && !isUnlocked}>
            <option value="" disabled>-- Select Batch --</option>
            {batchOptions.map((b) => <option key={b} value={b}>{b}</option>)}
            <option value="NEW">➕ Create New Batch</option>
          </select>
        </div>
        <div className="form-group">
          <label>
            Client Name 
            
            {client && client !== 'NEW' && (!isViewingPast || isUnlocked) && (
              <span className="edit-client-toggle" onClick={() => {
                const cData = clientsDb.find(c => c.name === client);
                setEditClientData({ name: cData.name, phone: cData.phone, address: cData.address, notes: cData.notes });
                setShowEditClientModal(true);
              }}>[✎ Edit]</span>
            )}

            {client && (
              <span className="advance-badge" style={{ marginLeft: '10px', color: '#2e7d32' }}>
                Advance: ₹{formatINR(currentAdvance - (parseFloat(advanceApplied) || 0))}
                <span className="add-funds-toggle" onClick={() => {setShowAddFunds(!showAddFunds); setPopoverMode('advance');}}> [+]</span>
                
                <span style={{ color: '#d32f2f', marginLeft: '10px' }}>
                  Pending: ₹{formatINR(currentPending)}
                  <span className="pay-debt-toggle" onClick={() => {setShowAddFunds(!showAddFunds); setPopoverMode('debt');}}> [-]</span>
                </span>
              </span>
            )}
          </label>
          
          <select value={client} disabled={isViewingPast && !isUnlocked} onChange={(e) => {
            const val = e.target.value;
            if (val === 'NEW') {
              setShowAddClientModal(true);
            } else {
              setClient(val);
              setShowAddFunds(false);
              setAdvanceApplied(''); 
            }
          }}>
            <option value="">-- Select Client --</option>
            {clientsDb.map((c) => (
              <option key={c.name} value={c.name}>{c.name}</option>
            ))}
            <option value="NEW">➕ Add New Client</option>
          </select>
          
          {showAddFunds && !isViewingPast && (
            <div className="add-funds-popover">
              <input type="text" inputMode="decimal" className="smart-field" value={formatInputINR(fundsToAdd)} onChange={handleFundsInputChange} placeholder="Amount (₹)" />
              <select value={advancePayMode} onChange={(e) => setAdvancePayMode(e.target.value)} className="payment-mode-select" style={{ marginLeft: '10px', padding: '5px' }}>
                <option value="Cash">Cash</option>
                <option value="UPI">UPI</option>
                <option value="Bank Transfer">Bank Transfer</option>
                <option value="Cheque">Cheque</option>
                <option value="Apply Advance" style={{color: '#2e7d32', fontWeight: 'bold'}}>Apply Advance</option>
              </select>
              <button 
                className={popoverMode === 'advance' ? "btn-add-funds" : "btn-pay-debt"} 
                onClick={popoverMode === 'advance' ? handleAddFunds : handlePayDebt} 
                style={{ marginLeft: '10px' }}>
                {popoverMode === 'advance' ? 'Add' : 'Submit'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ========================================= */}
      {/* NEW MODERN CSS GRID INVENTORY CARDS       */}
      {/* ========================================= */}
      <div className="inventory-container" style={{ pointerEvents: (isViewingPast && !isUnlocked) ? 'none' : 'auto', opacity: (isViewingPast && !isUnlocked) ? 0.7 : 1 }}>
        <div className="inventory-list">
          
          {/* Desktop Header Row */}
          <div className="inventory-header">
            <div>Description</div>
            <div>Qty</div>
            <div>Unit</div>
            <div>Total Count</div>
            <div>Unit Cost (₹)</div>
            <div>Discount (₹)</div>
            <div>Subtotal</div>
            <div></div>
          </div>
          
          {/* Mapped Item Rows / Cards */}
          {items.map((item) => (
            <div key={item.id} className="inventory-row">
              <div data-label="Description">
                <input type="text" className="smart-field" value={item.desc} onChange={(e) => handleInputChange(item.id, 'desc', e.target.value)} placeholder="Item description" />
              </div>
              <div data-label="Qty">
                <input type="text" className="smart-field" inputMode="decimal" value={item.qty === 0 ? '' : item.qty} onFocus={(e) => e.target.select()} onChange={(e) => handleInputChange(item.id, 'qty', e.target.value)} placeholder="0" />
              </div>
              <div data-label="Unit">
                <select className="smart-field" style={{ padding: '8px' }} value={item.unit} onChange={(e) => handleInputChange(item.id, 'unit', e.target.value)}>
                  <option value="Trays">Trays</option>
                  <option value="Birds">Birds</option>
                  <option value="Loads">Load</option>
                  <option value="Other">Other</option>
                </select>
              </div>
              <div data-label="Total Count" style={{ display: 'flex', alignItems: 'center', paddingLeft: '5px' }}>
                {item.totalCount}
              </div>
              <div data-label="Unit Cost (₹)">
                <input type="text" className="smart-field" inputMode="decimal" value={item.price === 0 ? '' : item.price} onFocus={(e) => e.target.select()} onChange={(e) => handleInputChange(item.id, 'price', e.target.value)} placeholder="0.00" />
              </div>
              <div data-label="Discount (₹)">
                <input type="text" className="smart-field" inputMode="decimal" value={item.discount === 0 ? '' : item.discount} onFocus={(e) => e.target.select()} onChange={(e) => handleInputChange(item.id, 'discount', e.target.value)} placeholder="0.00" />
              </div>
              <div data-label="Subtotal" className="inv-subtotal-wrapper" style={{ display: 'flex', alignItems: 'center' }}>
                <span className="inv-subtotal">₹{formatINR(item.subtotal)}</span>
              </div>
              <div className="remove-btn-wrapper" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                <span className="btn-remove-modern" title="Remove Item" onClick={() => removeRow(item.id)}>×</span>
              </div>
            </div>
          ))}
        </div>

        {/* Modern Green Pill Button */}
        <button className="btn-add-item-modern" onClick={addRow} disabled={isViewingPast && !isUnlocked}>
          + Add Item
        </button>
      </div>

      <div className="ledger-section" style={{ pointerEvents: (isViewingPast && !isUnlocked) ? 'none' : 'auto', opacity: (isViewingPast && !isUnlocked) ? 0.7 : 1 }}>
        
        {isViewingPast && !isUnlocked ? (
          <div className="ledger-grid">
            <div className="ledger-item">
              <span>Grand Total:</span>
              <strong>₹{formatINR(historicalLedger?.grandTotal)}</strong>
            </div>
            
            <div className="ledger-item">
              <span>Amount Paid:</span>
              <strong style={{ fontSize: '1rem', whiteSpace: 'pre-wrap' }}>{historicalLedger?.paidStr}</strong>
            </div>

            <div className="ledger-item">
              <span>Balance Due:</span>
              <strong>₹{formatINR(historicalLedger?.balance)}</strong>
            </div>
            
            <div className="ledger-item">
              <span>Status:</span>
              <span className={`payment-status-badge status-${historicalLedger?.status?.toLowerCase()}`}>
                {historicalLedger?.status}
              </span>
            </div>
          </div>
        ) : (
          <div className="ledger-grid">
            <div className="ledger-item">
              <span>Grand Total:</span>
              <strong>{grandTotal.toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}</strong>
            </div>
            
            <div className="ledger-item">
              <span>Amount Paid (₹):</span>
            <input 
              type="text" 
              className="smart-field payment-input-box"
              value={formatInputINR(paidAmount)} 
              onChange={handleAmountPaidChange} 
              placeholder="Amount (₹)"
              disabled={grandTotal <= 0 || (parseFloat(advanceApplied) || 0) >= grandTotal}
            />
            </div>

            <div className="ledger-item">
              <span>Payment Mode:</span>
              <select 
                value={paymentMode} 
                onChange={(e) => {
                  setPaymentMode(e.target.value);
                  if (e.target.value !== 'Cheque') setCheckNumber(''); 
                }}
                className="payment-mode-select"
              >
                <option value="Cash">Cash</option>
                <option value="UPI">UPI</option>
                <option value="Bank Transfer">Bank Transfer</option>
                <option value="Cheque">Cheque</option>
              </select>
              {paymentMode === 'Cheque' && (
                <input type="text" placeholder="Check No." className="check-number-input" value={checkNumber} onChange={(e) => setCheckNumber(e.target.value)} />
              )}
            </div>

            <div className="ledger-item">
              <span>Advance Applied (₹):</span>
            <input 
              type="text" 
              className="smart-field payment-input-box"
              value={formatInputINR(advanceApplied)} 
              onChange={handleAdvanceAppliedChange} 
              placeholder="Advance (₹)" 
              disabled={grandTotal <= 0 || currentAdvance <= 0 || (parseFloat(paidAmount) || 0) >= grandTotal}
            />
            </div>
            
            <div className="ledger-item">
              <span>Balance Due:</span>
              <strong>{balanceDue.toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}</strong>
            </div>
            
            <div className="ledger-item">
              <span>Status:</span>
              <span className={`payment-status-badge status-${derivedStatus.toLowerCase()}`}>
                {derivedStatus}
              </span>
            </div>
          </div>
        )}
      </div>

      <div className="action-buttons-container">
        {isViewingPast && !isUnlocked ? (
          historicalLedger?.status === 'Paid' ? (
            <>
              <button className="btn-secondary" onClick={handleClearSearch} style={{ marginRight: 'auto' }}>❌ Clear Search</button>
              <span style={{ color: '#2e7d32', fontWeight: 'bold', padding: '12px 24px', background: '#e8f5e9', border: '1px solid #c8e6c9', borderRadius: '6px', display: 'flex', alignItems: 'center' }}>
                🔒 Invoice Paid & Closed
              </span>
              <button className="btn-generate-pdf" onClick={handleReprintOnly}>🖨️ Re-Print PDF</button>
            </>
          ) : (
            <>
              <button className="btn-secondary" onClick={handleClearSearch} style={{ marginRight: 'auto' }}>❌ Clear Search</button>
              <button className="btn-unlock" onClick={() => setShowPinPrompt(true)}>🔒 Edit Locked Invoice</button>
              <button className="btn-generate-pdf" onClick={handleReprintOnly}>🖨️ Re-Print PDF</button>
            </>
          )
        ) : (
          <>
            {isViewingPast && <button className="btn-secondary" onClick={handleClearSearch} style={{ marginRight: 'auto' }}>❌ Cancel Edit</button>}
            <button className="btn-save-only" onClick={handleSaveOnly}>
              {isViewingPast ? <><span style={{ filter: 'grayscale(100%)' }}>💾</span> Update Master Data</> : <><span style={{ filter: 'grayscale(100%)' }}>💾</span> Save Only</>}
            </button>
            <button className="btn-generate-pdf" onClick={handleGeneratePDF}>
             {isViewingPast ? <><span style={{ filter: 'grayscale(100%)' }}>🖨️</span> Update Master & PDF</> : <><span style={{ filter: 'grayscale(100%)' }}>🖨️</span> Generate PDF & Save</>}
            </button>
          </>
        )}
      </div>

      {/* --- ADD NEW CLIENT MODAL --- */}
      {showAddClientModal && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ minWidth: '350px' }}>
            <h3 style={{ marginTop: 0, color: '#2e7d32' }}>Add New Client</h3>
            <input 
              type="text" 
              placeholder="Client Name (Required)" 
              value={newClientData.name} 
              onChange={e => setNewClientData({...newClientData, name: e.target.value})} 
              className="smart-field" 
              style={{ width: '100%', marginBottom: '10px', boxSizing: 'border-box' }} 
            />
            <input 
              type="text" 
              placeholder="Phone Number (Required)" 
              value={newClientData.phone} 
              onChange={e => setNewClientData({...newClientData, phone: e.target.value})} 
              className="smart-field" 
              style={{ width: '100%', marginBottom: '10px', boxSizing: 'border-box' }} 
            />
            <input 
              type="text" 
              placeholder="Address (Required)" 
              value={newClientData.address} 
              onChange={e => setNewClientData({...newClientData, address: e.target.value})} 
              className="smart-field" 
              style={{ width: '100%', marginBottom: '10px', boxSizing: 'border-box' }} 
            />
            <input 
              type="text" 
              placeholder="Notes / PAN / GST (Optional)" 
              value={newClientData.notes} 
              onChange={e => setNewClientData({...newClientData, notes: e.target.value})} 
              className="smart-field" 
              style={{ width: '100%', marginBottom: '20px', boxSizing: 'border-box' }} 
            />
            <div className="modal-buttons">
              <button className="btn-modal-unlock" onClick={handleAddClientSubmit} style={{ backgroundColor: '#2e7d32' }}>Save Client</button>
              <button className="btn-modal-cancel" onClick={() => {
                setShowAddClientModal(false); 
                setNewClientData({name:'', phone:'', address:'', notes:''}); 
                setClient('');
              }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* --- EDIT CLIENT MODAL --- */}
      {showEditClientModal && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ minWidth: '350px' }}>
            <h3 style={{ marginTop: 0, color: '#1976d2' }}>Edit Client Profile</h3>
            <input 
              type="text" 
              value={editClientData.name} 
              disabled={true} 
              className="smart-field" 
              style={{ width: '100%', marginBottom: '10px', boxSizing: 'border-box', backgroundColor: '#e9ecef', color: '#666', cursor: 'not-allowed' }} 
            />
            <input 
              type="text" 
              placeholder="Phone Number (Required)" 
              value={editClientData.phone} 
              onChange={e => setEditClientData({...editClientData, phone: e.target.value})} 
              className="smart-field" 
              style={{ width: '100%', marginBottom: '10px', boxSizing: 'border-box' }} 
            />
            <input 
              type="text" 
              placeholder="Address (Required)" 
              value={editClientData.address} 
              onChange={e => setEditClientData({...editClientData, address: e.target.value})} 
              className="smart-field" 
              style={{ width: '100%', marginBottom: '10px', boxSizing: 'border-box' }} 
            />
            <input 
              type="text" 
              placeholder="Notes / PAN / GST (Optional)" 
              value={editClientData.notes} 
              onChange={e => setEditClientData({...editClientData, notes: e.target.value})} 
              className="smart-field" 
              style={{ width: '100%', marginBottom: '20px', boxSizing: 'border-box' }} 
            />
            <div className="modal-buttons">
              <button className="btn-modal-unlock" onClick={handleEditClientSubmit} style={{ backgroundColor: '#1976d2' }}>Update Profile</button>
              <button className="btn-modal-cancel" onClick={() => setShowEditClientModal(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* --- PIN SECURITY MODAL --- */}
      {showPinPrompt && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3>Security Verification</h3>
            <p>Please enter the Admin PIN to override and edit Invoice {invoiceNo}.</p>
            <input type="password" value={pinInput} onChange={(e) => setPinInput(e.target.value)} maxLength={6} />
            <div className="modal-buttons">
              <button className="btn-modal-unlock" onClick={handleUnlockSubmit}>Unlock Database</button>
              <button className="btn-modal-cancel" onClick={() => {setShowPinPrompt(false); setPinInput('');}}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================= */}
      {/* HIDDEN PRINT-ONLY INVOICE TEMPLATE        */}
      {/* ========================================= */}
      <div className="print-engine-wrapper" ref={printRef} style={{ position: 'absolute', top: '-9999px', left: '-9999px' }}>
        
        {paginatedItems.map((pageChunk, pageIndex) => (
          
          <div key={pageIndex} className="print-page" style={{ position: 'relative', width: '210mm', height: '297mm', backgroundColor: 'white', overflow: 'hidden', pageBreakAfter: 'always' }}>
            <img src="/letterhead.png" alt="Letterhead" className="print-background" />
            
            <div className="print-content">
              {pageIndex === 0 && (
                <div className="print-header-info">
                  <div>
                    <h3>Billed To:</h3>
                    <p><strong>{client || 'Cash Customer'}</strong></p>
                    {selectedClientData && (
                      <>
                        <p>Ph: {selectedClientData.phone}</p>
                        <p>{selectedClientData.address}</p>
                      </>
                    )}
                  </div>
                  <div className="print-meta">
                    <p><strong>Invoice No:</strong> {invoiceNo || 'Draft'}</p>
                    <p><strong>Date:</strong> {formatDateToDDMMYYYY(date)}</p>
                    <p><strong>Batch:</strong> {batch}</p>
                    {selectedClientData && selectedClientData.notes && (
                      <p><strong>Notes:</strong> {selectedClientData.notes}</p>
                    )}
                  </div>
                </div>
              )}

              <table className="print-table">
                <thead>
                  <tr>
                    <th>Description</th>
                    <th>Qty</th>
                    <th>Total Count</th>
                    <th>Rate</th>
                    <th>Discount</th>
                    <th>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {pageChunk.map(item => (
                    <tr key={item.id}>
                      <td>{item.desc || 'Item'}</td>
                      <td>{formatCount(item.qty)} {item.unit}</td>
                      <td>{formatCount(item.totalCount)}</td>
                      <td>₹{formatINR(item.price)}</td>
                      <td>₹{formatINR(item.discount)}</td>
                      <td>₹{formatINR(item.subtotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {pageIndex === paginatedItems.length - 1 && (
                <div className="print-totals">
                  
                  <div className="print-bank-details">
                    <div className="bank-row">
                      <strong>Bank:</strong>
                      <span>Kotak Mahindra Bank</span>
                    </div>
                    <div className="bank-row">
                      <strong>Branch:</strong>
                      <span>Rajkot-kalavad Road</span>
                    </div>
                    <div className="bank-row">
                      <strong>IFSC ID:</strong>
                      <span>KKBK0002794</span>
                    </div>
                    <div className="bank-row">
                      <strong>Account No:</strong>
                      <span>8000089000</span>
                    </div>
                    <div className="bank-row">
                      <strong>UPI ID:</strong>
                      <span>urbaneggs@kotak</span>
                    </div>
                  </div>

                  <div className="print-totals-numbers">
                    <p><strong>Grand Total:</strong> ₹{formatINR(historicalLedger ? historicalLedger.grandTotal : grandTotal)}</p>
                    
                    <p><strong>Amount Paid:</strong> ₹{formatINR(historicalLedger ? (historicalLedger.grandTotal - historicalLedger.balance) : (numericPaidAmount + numericAdvanceApplied))}</p>
                    
                    <p><strong>Balance Due:</strong> ₹{formatINR(historicalLedger ? historicalLedger.balance : balanceDue)}</p>
                  </div>
                </div>
              )} 
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}