import React, { useState, useEffect } from 'react';
import './App.css';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { useRef } from 'react';

// --- FORMATTING & MATH TOOLS ---

// 1. Core Math Rounder: Destroys infinite decimals natively
const roundMath = (num) => {
  return Math.round((Number(num) || 0) * 100) / 100;
};

// 2. Formats Currency: Indian commas + strictly 2 decimal places
const formatINR = (value) => {
  return Number(value || 0).toLocaleString('en-IN', { 
    minimumFractionDigits: 2, 
    maximumFractionDigits: 2 
  });
};

// 3. Formats Counts: Indian commas + allows up to 2 decimal places 
const formatCount = (value) => {
  return Number(value || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  });
};

// 4. Input Bouncer: Forces numbers only and strictly 2 decimal places
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

// 5. Smart Input Formatter: Adds commas for typing without breaking decimals
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

const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxpo0qxQ9BWImoLlVBEty3Tv3VBNL2IRdExi1UNKNovTDdwr_qrt-lDRg9TOiUqMoOF8w/exec";

export default function App() {
  const printRef = useRef(null);

  const [isGenerating, setIsGenerating] = useState(false);
  // --- CONTROL PANEL STATE ---
  const [invoiceNo, setInvoiceNo] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [batch, setBatch] = useState('Batch 1');
  const [client, setClient] = useState('');

  const [clientsDb, setClientsDb] = useState([]);

  const [showAddFunds, setShowAddFunds] = useState(false);
  const [fundsToAdd, setFundsToAdd] = useState('');
  const [advanceNo, setAdvanceNo] = useState('');
  const [advancePayMode, setAdvancePayMode] = useState('Cash');
  // --- INVENTORY TABLE STATE ---
  const [items, setItems] = useState([
    { id: Date.now(), desc: '', qty: 0, unit: 'Trays', price: 0, discount: 0, subtotal: 0, totalCount: 0 }
  ]);

  // --- LEDGER STATE ---
  const [paidAmount, setPaidAmount] = useState(''); 
  const [advanceApplied, setAdvanceApplied] = useState('');
  const [paymentMode, setPaymentMode] = useState('Cash');
  const [checkNumber, setCheckNumber] = useState('');

// --- FETCH INITIAL DATA FROM GOOGLE SHEETS ---
  useEffect(() => {
    const fetchInitialData = async () => {
      try {
        const response = await fetch(SCRIPT_URL, {
          method: 'POST',
          body: JSON.stringify({ action: 'getInitialData' }),
        });
        
        const data = await response.json();
        
        // Populate the app with live data
        if (data.clients) setClientsDb(data.clients);
        if (data.nextInvoice) setInvoiceNo(data.nextInvoice);
        if (data.nextAdvance) setAdvanceNo(data.nextAdvance);

        console.log("✅ Successfully connected to Master Sheet:", data);
      } catch (error) {
        console.error("❌ Error fetching data:", error);
        alert("Failed to connect to the database. Check your internet connection or Apps Script URL.");
      }
    };

    fetchInitialData();
  }, []); // The empty array means this only runs once when the app opens

  // --- LOGIC CALCULATIONS ---
  const grandTotal = items.reduce((sum, item) => sum + item.subtotal, 0);
  
  // Find selected client's advance
  const selectedClientData = clientsDb.find(c => c.name === client);
  const currentAdvance = selectedClientData ? selectedClientData.advance : 0;

  const numericPaidAmount = parseFloat(paidAmount) || 0;
  const numericAdvanceApplied = parseFloat(advanceApplied) || 0;
  const totalDeductions = numericPaidAmount + numericAdvanceApplied;
  const balanceDue = Math.max(0, grandTotal - totalDeductions);

  let derivedStatus = 'Pending';
  if (totalDeductions > 0) {
    if (totalDeductions >= grandTotal) derivedStatus = 'Paid';
    else derivedStatus = 'Partial';
  }

  const batchOptions = Array.from({ length: 50 }, (_, i) => `Batch ${i + 1}`);

  // --- HANDLERS ---
const handleAddFunds = async () => {
    const num = parseFloat(fundsToAdd) || 0;
    
    if (num > 0 && client && advanceNo) {
      // 1. Package the payload for the Advance Ledger
      const payload = {
        action: 'logAdvance',
        date: new Date().toISOString().split('T')[0], // Today's date
        advNo: advanceNo,
        client: client,
        amount: num,
        payMode: advancePayMode
      };

      try {
        // 2. Send to Google Sheets
        const response = await fetch(SCRIPT_URL, {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        const result = await response.json();

        if (result.success) {
          // 3. Update the frontend wallet balance immediately
          setClientsDb(prevDb => prevDb.map(c =>
            c.name === client ? { ...c, advance: c.advance + num } : c
          ));
          
          alert(`Success! Advance ${advanceNo} for ₹${num} added to the Ledger.`);
          
          // 4. Increment the Advance Number for the next transaction
          const parts = advanceNo.split('-');
          if(parts.length === 3) {
            const nextSeq = ("000" + (parseInt(parts[2], 10) + 1)).slice(-3);
            setAdvanceNo(`${parts[0]}-${parts[1]}-${nextSeq}`);
          }
        } else {
          alert("Failed to save advance to the database.");
        }
      } catch (error) {
        console.error("Error saving advance:", error);
        alert("Connection error. Could not save to database.");
      }
    }
    
    // Close the popover and reset fields
    setShowAddFunds(false);
    setFundsToAdd('');
    setAdvancePayMode('Cash'); 
  };

const handleFundsInputChange = (e) => {
    setFundsToAdd(enforceTwoDecimals(e.target.value));
  };

const handleInputChange = (id, field, value) => {
    const newItems = items.map(item => {
      if (item.id === id) {
        // Apply our bouncer ONLY to the number fields
        let safeValue = value;
        if (field === 'qty' || field === 'price' || field === 'discount') {
          safeValue = enforceTwoDecimals(value);
        }
        
        const updatedItem = { ...item, [field]: safeValue };
        const qtyNum = parseFloat(updatedItem.qty) || 0;
        const priceNum = parseFloat(updatedItem.price) || 0;
        const discountNum = parseFloat(updatedItem.discount) || 0;
        const multiplier = (updatedItem.unit === 'Trays') ? 30 : 1;
        
        // --- STEP 2: The Math Rounder is applied here! ---
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
    
    // Allow the box to be completely empty so the user can backspace freely
    if (safeVal === '') {
      setPaidAmount('');
      return;
    }

    const numVal = parseFloat(safeVal) || 0;
    const currentAdvanceApplied = parseFloat(advanceApplied) || 0;
    
    // The Seesaw: Max allowed is Grand Total minus whatever Advance is already applied
    const maxApplicable = roundMath(grandTotal - currentAdvanceApplied);

    if (numVal > maxApplicable) {
      safeVal = maxApplicable.toString();
    }
    setPaidAmount(safeVal);
  };

  const handleAdvanceAppliedChange = (e) => {
    let safeVal = enforceTwoDecimals(e.target.value);
    
    if (safeVal === '') {
      setAdvanceApplied('');
      return;
    }

    const numVal = parseFloat(safeVal) || 0;
    const currentPaid = parseFloat(paidAmount) || 0;
    
    // The Seesaw: Max allowed is available wallet balance OR remaining Grand Total
    const maxApplicable = Math.min(currentAdvance, roundMath(grandTotal - currentPaid));

    if (numVal > maxApplicable) {
      safeVal = maxApplicable.toString();
    }
    setAdvanceApplied(safeVal);
  };

  const addRow = () => {
    setItems([...items, { id: Date.now(), desc: '', qty: 0, unit: 'Trays', price: 0, discount: 0, subtotal: 0, totalCount: 0 }]);
  };

  const removeRow = (id) => {
    if (items.length > 1) setItems(items.filter(item => item.id !== id));
  };

  // --- RESET DASHBOARD HELPER ---
  const resetDashboard = () => {
    // 1. Clear the client and ledger
    setClient('');
    setPaidAmount('');
    setAdvanceApplied('');
    setPaymentMode('Cash');
    setCheckNumber('');
    
    // 2. Reset the inventory table to a single blank row
    setItems([{ id: Date.now(), desc: '', qty: 0, unit: 'Trays', price: 0, discount: 0, subtotal: 0, totalCount: 0 }]);
    
    // 3. Increment the invoice number for the next customer
    const parts = invoiceNo.split('-');
    if (parts.length === 3) {
      const nextSeq = ("000" + (parseInt(parts[2], 10) + 1)).slice(-3);
      setInvoiceNo(`${parts[0]}-${parts[1]}-${nextSeq}`);
    }
  };
// --- SUBMISSION ACTIONS ---

  // 1. The Database Engine (Only handles the connection)
  const submitInvoiceData = async () => {
    const itemsSummary = items.map(i => {
      const priceUnit = i.unit === 'Trays' ? 'Egg' : i.unit;
      return `${i.qty} ${i.unit} - ${i.desc || 'Item'} @ ₹${i.price}/${priceUnit} (Disc: ₹${i.discount})`;
    }).join(' | ');

    const finalPaymentMode = paymentMode === 'Cheque' && checkNumber ? `Cheque (No. ${checkNumber})` : paymentMode;

    const totalTrays = items.filter(i => i.unit === 'Trays').reduce((sum, i) => sum + (parseFloat(i.qty) || 0), 0);
    const totalBirds = items.filter(i => i.unit === 'Birds').reduce((sum, i) => sum + (parseFloat(i.qty) || 0), 0);
    const totalEggs = items.filter(i => i.unit === 'Trays').reduce((sum, i) => sum + ((parseFloat(i.qty) || 0) * 30), 0);

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
      payMode: finalPaymentMode, ledgerEntry: "Sale" 
    };

    try {
      const response = await fetch(SCRIPT_URL, { method: 'POST', body: JSON.stringify(payload) });
      const result = await response.json();
      if (!result.success) alert(`Save failed: ${result.message}`);
      return result.success; 
    } catch (error) {
      console.error("Error saving data:", error);
      alert("Connection error. Could not save to database.");
      return false;
    }
  };

  // 2. Button A: Save Only
  const handleSaveOnly = async () => {
    const isSaved = await submitInvoiceData();
    if (isSaved) {
      alert(`Success! Invoice ${invoiceNo} has been saved.`);
      resetDashboard(); // Reset immediately
    }
  };

  // 3. Button B: Generate PDF & Save
  const handleGeneratePDF = async () => {
    const isSaved = await submitInvoiceData();
    if (!isSaved) return; // Stop everything if the database save fails!

    // Wait a moment for React to finish any rendering
    await new Promise((resolve) => setTimeout(resolve, 100));
    const element = printRef.current;
    if (!element) return;

    try {
      const canvas = await html2canvas(element, { scale: 2, useCORS: true, backgroundColor: "#ffffff", logging: false });
      const imgData = canvas.toDataURL('image/jpeg', 0.75);
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
      
      pdf.addImage(imgData, 'JPEG', 0, 0, pdfWidth, pdfHeight, undefined, 'FAST');
      pdf.save(`UrbanEggs_Invoice_${invoiceNo}.pdf`);
      
      resetDashboard(); // Reset ONLY after the PDF is safely downloaded!
    } catch (error) {
      console.error("PDF generation failed:", error);
      alert("Database saved, but PDF generation failed.");
    }
  };
  return (
    <div className="dashboard-container">
      {/* Header Section */}
      <div className="header">
        <img src="/logo.png" alt="Urban Eggs Logo" className="header-logo" />
        <h1>Urban Eggs - Dashboard</h1>
        <div className="header-spacer"></div>
      </div>

      {/* Control Panel */}
      <div className="meta-grid">
        <div className="form-group">
          <label>Invoice Number</label>
          <input type="text" className="smart-field" value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} />
        </div>
        <div className="form-group">
          <label>Date</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="form-group">
          <label>Batch Number</label>
          <select value={batch} onChange={(e) => setBatch(e.target.value)}>
            {batchOptions.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label>
            Client Name 
            {client && (
              <span className="advance-badge">Advance: ₹{formatINR(currentAdvance - (parseFloat(advanceApplied) || 0))}
                <span className="add-funds-toggle" onClick={() => setShowAddFunds(!showAddFunds)}> [+]</span>
              </span>
            )}
          </label>
          <select value={client} onChange={(e) => {
            setClient(e.target.value);
            setShowAddFunds(false);
            setAdvanceApplied(''); // Reset ledger advance when switching clients
          }}>
            <option value="">-- Select Client --</option>
            {clientsDb.map((c) => (
              <option key={c.name} value={c.name}>{c.name}</option>
            ))}
          </select>
          
          {/* Inline Add Funds Popover */}
          {showAddFunds && (
            <div className="add-funds-popover">
              <input 
                type="text" 
                inputMode="decimal" 
                className="smart-field"
                value={formatInputINR(fundsToAdd)}
                onChange={handleFundsInputChange} 
                placeholder="Amount (₹)" 
              />
              <select 
                value={advancePayMode} 
                onChange={(e) => setAdvancePayMode(e.target.value)}
                className="payment-mode-select"
                style={{ marginLeft: '10px', padding: '5px' }}
              >
                <option value="Cash">Cash</option>
                <option value="UPI">UPI</option>
                <option value="Bank Transfer">Bank Transfer</option>
                <option value="Cheque">Cheque</option>
              </select>
              <button className="btn-add-funds" onClick={handleAddFunds} style={{ marginLeft: '10px' }}>Add</button>
            </div>
          )}
        </div>
      </div>

      {/* Inventory Table */}
      <div className="table-responsive-wrapper">
        <table className="item-table">
          <thead>
            <tr>
              <th style={{ width: '35%' }}>Description</th>
              <th style={{ width: '10%' }}>Qty</th>
              <th style={{ width: '10%' }}>Unit</th>
              <th style={{ width: '10%' }}>Total Count</th>
              <th style={{ width: '10%' }}>Unit Cost (₹)</th>
              <th style={{ width: '10%' }}>Discount (₹)</th>
              <th style={{ width: '10%' }}>Subtotal (₹)</th>
              <th style={{ width: '5%' }}></th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td><input type="text" value={item.desc} onChange={(e) => handleInputChange(item.id, 'desc', e.target.value)} /></td>
                <td><input type="text" inputMode="decimal" value={item.qty} onFocus={(e) => e.target.select()} onChange={(e) => handleInputChange(item.id, 'qty', e.target.value)} /></td>
                <td>
                  <select value={item.unit} onChange={(e) => handleInputChange(item.id, 'unit', e.target.value)}>
                    <option value="Trays">Trays</option>
                    <option value="Birds">Birds</option>
                    <option value="Loads">Load</option>
                    <option value="Other">Other</option>
                  </select>
                </td>
                <td>{item.totalCount}</td>
                <td><input type="text" inputMode="decimal" value={item.price === 0 ? '' : item.price} onFocus={(e) => e.target.select()} onChange={(e) => handleInputChange(item.id, 'price', e.target.value)} /></td>
                <td><input type="text" inputMode="decimal" value={item.discount === 0 ? '' : item.discount} onFocus={(e) => e.target.select()} onChange={(e) => handleInputChange(item.id, 'discount', e.target.value)} /></td>
                <td><strong>{item.subtotal.toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}</strong></td>
                <td><span className="btn-remove" onClick={() => removeRow(item.id)}>×</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button className="btn-add-row" onClick={addRow}>+ Add Item</button>

      {/* Ledger Section */}
      <div className="ledger-section">
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
              <input 
                type="text" 
                placeholder="Check No." 
                className="check-number-input"
                value={checkNumber}
                onChange={(e) => setCheckNumber(e.target.value)}
              />
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
      </div>

      {/* Action Buttons */}
      <div className="action-buttons-container">
        <button className="btn-save-only" onClick={handleSaveOnly}>
          💾 Save Only
        </button>
        <button className="btn-generate-pdf" onClick={handleGeneratePDF}>
          🖨️ Generate PDF & Save
        </button>
      </div>
            {/* ========================================= */}
      {/* HIDDEN PRINT-ONLY INVOICE TEMPLATE          */}
      {/* ========================================= */}
      <div className="print-only-invoice" ref={printRef}>
        <img src="/letterhead.png" alt="Letterhead" className="print-background" />
        {/* Adjust top padding in CSS to push text below your PNG's header graphics */}
        <div className="print-content">
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
            </div>
          </div>

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
              {items.map(item => (
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

          <div className="print-totals">
            <p><strong>Grand Total:</strong> ₹{formatINR(grandTotal)}</p>
            <p><strong>Amount Paid:</strong> ₹{formatINR(numericPaidAmount + numericAdvanceApplied)} ({paymentMode})</p>
            <p><strong>Balance Due:</strong> ₹{formatINR(balanceDue)}</p>
          </div>
        </div>
      </div>
    </div>
  );
}