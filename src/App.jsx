import React, { useState } from 'react';
import './App.css';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { useRef } from 'react';

// Helper function for Indian comma formatting
const formatNumberWithCommas = (value) => {
  if (!value) return '';
  const parts = value.toString().split('.');
  parts[0] = parts[0].replace(/(\d)(?=(\d\d)+\d$)/g, "$1,");
  return parts.join('.');
};

export default function App() {
  const printRef = useRef(null);

  const [isGenerating, setIsGenerating] = useState(false);
  // --- CONTROL PANEL STATE ---
  const [invoiceNo, setInvoiceNo] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [batch, setBatch] = useState('Batch 1');
  const [client, setClient] = useState('');

  // --- MOCK CLIENT DATABASE & ADVANCE STATE ---
// --- MOCK CLIENT DATABASE ---
  const [clientsDb, setClientsDb] = useState([
    { name: 'John Doe', advance: 5000, phone: '555-0101', address: '123 Farm Rd, Hanover Park, IL' },
    { name: 'Jane Smith', advance: 12000, phone: '555-0202', address: '456 Market St, Chicago, IL' },
    { name: 'Urban Cafe', advance: 0, phone: '555-0303', address: '789 Main St, Elgin, IL' }
  ]);
  const [showAddFunds, setShowAddFunds] = useState(false);
  const [fundsToAdd, setFundsToAdd] = useState('');

  // --- INVENTORY TABLE STATE ---
  const [items, setItems] = useState([
    { id: Date.now(), desc: '', qty: 0, unit: 'Trays', price: 0, discount: 0, subtotal: 0, totalCount: 0 }
  ]);

  // --- LEDGER STATE ---
  const [paidAmount, setPaidAmount] = useState(''); 
  const [advanceApplied, setAdvanceApplied] = useState('');
  const [paymentMode, setPaymentMode] = useState('Cash');
  const [checkNumber, setCheckNumber] = useState('');

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
  const handleAddFunds = () => {
    const num = parseFloat(fundsToAdd) || 0;
    if (num > 0 && client) {
      setClientsDb(prevDb => prevDb.map(c =>
        c.name === client ? { ...c, advance: c.advance + num } : c
      ));
    }
    setShowAddFunds(false);
    setFundsToAdd('');
  };

  const handleFundsInputChange = (e) => {
    let val = e.target.value.replace(/,/g, '').replace(/[^0-9.]/g, '');
    const parts = val.split('.');
    if (parts.length > 2) val = parts[0] + '.' + parts.slice(1).join('');
    setFundsToAdd(val);
  };

  const handleInputChange = (id, field, value) => {
    const newItems = items.map(item => {
      if (item.id === id) {
        const updatedItem = { ...item, [field]: value };
        const qtyNum = parseFloat(updatedItem.qty) || 0;
        const priceNum = parseFloat(updatedItem.price) || 0;
        const discountNum = parseFloat(updatedItem.discount) || 0;
        const multiplier = (updatedItem.unit === 'Trays') ? 30 : 1;
        
        updatedItem.totalCount = qtyNum * multiplier;
        updatedItem.subtotal = updatedItem.totalCount * (priceNum - discountNum);
        return updatedItem;
      }
      return item;
    });
    setItems(newItems);
  };

  const handleAmountPaidChange = (e) => {
    let val = e.target.value.replace(/,/g, '').replace(/[^0-9.]/g, '');
    const parts = val.split('.');
    if (parts.length > 2) val = parts[0] + '.' + parts.slice(1).join('');
    setPaidAmount(val);
  };

  const handleAdvanceAppliedChange = (e) => {
    let val = e.target.value.replace(/,/g, '').replace(/[^0-9.]/g, '');
    const parts = val.split('.');
    if (parts.length > 2) val = parts[0] + '.' + parts.slice(1).join('');
    
    // Hard Ceiling Guard: Prevents applying more than Grand Total OR actual available Advance
    const maxApplicable = Math.min(grandTotal, currentAdvance);
    if (parseFloat(val) > maxApplicable) {
      val = maxApplicable.toString();
    }
    setAdvanceApplied(val);
  };

  const addRow = () => {
    setItems([...items, { id: Date.now(), desc: '', qty: 0, unit: 'Trays', price: 0, discount: 0, subtotal: 0, totalCount: 0 }]);
  };

  const removeRow = (id) => {
    if (items.length > 1) setItems(items.filter(item => item.id !== id));
  };
  // --- SUBMISSION ACTIONS ---
  const handleSave = () => {
    // 1. Format the Items Summary with Prices and Discounts
    const itemsSummary = items.map(i => 
      `${i.qty} ${i.unit} - ${i.desc || 'Item'} @ ₹${i.price}/${i.unit} (Disc: ₹${i.discount})`
    ).join(' | ');

    // 2. Format the Check Number into the Payment Mode
    const finalPaymentMode = paymentMode === 'Cheque' && checkNumber 
      ? `Cheque (No. ${checkNumber})` 
      : paymentMode;

    // 3. Package the Data Payload
    const payload = {
      invoiceNo, date, batch, client,
      grandTotal, paid: numericPaidAmount, advanceApplied: numericAdvanceApplied,
      balanceDue, status: derivedStatus, itemsSummary, paymentMode: finalPaymentMode
    };

    // For testing: Print this to the console so we can see what goes to Google Sheets
    console.log("📦 PAYLOAD READY FOR GOOGLE SHEETS:", payload);
    
    // Optional: We can add an alert here to confirm it worked during testing
    alert(`Saved! Payload packaged for Master Sheet.\n(Check browser console to view data)`);
  };

  const handleGeneratePDF = async () => {
  // 1. Save the data
  handleSave();
  
  // 2. Allow render
  await new Promise((resolve) => setTimeout(resolve, 100));

  const element = printRef.current;
  if (!element) return;

  try {
    // Capture the element
    const canvas = await html2canvas(element, {
      scale: 2, 
      useCORS: true,
      backgroundColor: "#ffffff", // Ensures white background
      logging: false
    });
    
    const imgData = canvas.toDataURL('image/png');
    
    // Create PDF
    const pdf = new jsPDF('p', 'mm', 'a4');
    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
    
    pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
    
    // Save
    pdf.save(`UrbanEggs_Invoice_${invoiceNo || 'Draft'}.pdf`);
  } catch (error) {
    console.error("PDF generation failed:", error);
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
              <span className="wallet-badge">
                Advance: ₹{formatNumberWithCommas(currentAdvance)}
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
                value={formatNumberWithCommas(fundsToAdd)} 
                onChange={handleFundsInputChange} 
                placeholder="Amount (₹)" 
              />
              <button className="btn-add-funds" onClick={handleAddFunds}>Add Funds</button>
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
              <th style={{ width: '15%' }}>Unit</th>
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
                    <option value="Tractors">Tractor/Load</option>
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
              inputMode="decimal" 
              className="amount-paid-input"
              value={formatNumberWithCommas(paidAmount)} 
              onFocus={(e) => e.target.select()} 
              onChange={handleAmountPaidChange} 
              placeholder="0.00"
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
              inputMode="decimal" 
              className="amount-paid-input"
              value={formatNumberWithCommas(advanceApplied)} 
              onFocus={(e) => e.target.select()} 
              onChange={handleAdvanceAppliedChange} 
              placeholder="0.00"
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
        <button className="btn-save-only" onClick={handleSave}>
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
                  <p>{selectedClientData.phone}</p>
                  <p>{selectedClientData.address}</p>
                </>
              )}
            </div>
            <div className="print-meta">
              <p><strong>Invoice No:</strong> {invoiceNo || 'Draft'}</p>
              <p><strong>Date:</strong> {date}</p>
              <p><strong>Batch:</strong> {batch}</p>
            </div>
          </div>

          <table className="print-table">
            <thead>
              <tr>
                <th>Description</th>
                <th>Qty</th>
                <th>Rate</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {items.map(item => (
                <tr key={item.id}>
                  <td>{item.desc || 'Item'}</td>
                  <td>{item.qty} {item.unit}</td>
                  <td>₹{item.price}</td>
                  <td>₹{item.subtotal}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="print-totals">
            <p><strong>Grand Total:</strong> ₹{grandTotal}</p>
            <p><strong>Amount Paid:</strong> ₹{numericPaidAmount + numericAdvanceApplied} ({paymentMode})</p>
            <p><strong>Balance Due:</strong> ₹{balanceDue}</p>
          </div>
        </div>
      </div>
    </div>
  );
}