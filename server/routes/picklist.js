const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const ExcelJS = require('exceljs');

/**
 * POST /api/picklist/generate
 * Generate pick list data grouped by courier
 */
router.post('/generate', async (req, res) => {
  try {
    const { storeName, courierName, dateFrom, dateTo } = req.body;
    
    // Build query with filters
    let query = `
      SELECT 
        courier_name,
        product_name,
        SUM(quantity) as quantity
      FROM labels
      WHERE 1=1
    `;
    
    const params = [];
    
    if (storeName) {
      query += ` AND store_name = ?`;
      params.push(storeName);
    }
    
    if (courierName) {
      query += ` AND courier_name = ?`;
      params.push(courierName);
    }
    
    if (dateFrom) {
      query += ` AND label_date >= ?`;
      params.push(dateFrom);
    }
    
    if (dateTo) {
      // Include end of day for dateTo
      const endDate = new Date(dateTo);
      endDate.setHours(23, 59, 59, 999);
      query += ` AND label_date <= ?`;
      params.push(endDate.toISOString());
    }
    
    query += ` GROUP BY courier_name, product_name ORDER BY courier_name, product_name`;
    
    const [results] = await pool.execute(query, params);
    
    // Group by courier
    const groupedData = results.reduce((acc, row) => {
      const existing = acc.find(g => g.courier_name === row.courier_name);
      if (existing) {
        existing.products.push({
          product_name: row.product_name,
          quantity: Number(row.quantity)
        });
      } else {
        acc.push({
          courier_name: row.courier_name,
          products: [{
            product_name: row.product_name,
            quantity: Number(row.quantity)
          }]
        });
      }
      return acc;
    }, []);
    
    res.json(groupedData);
  } catch (error) {
    console.error('Error generating pick list:', error);
    res.status(500).json({ error: 'Failed to generate pick list' });
  }
});

/**
 * POST /api/picklist/download
 * Download pick list as Excel in PIVOT TABLE format:
 * - Rows: Product Names
 * - Columns: Couriers (Ekart, Delhivery, etc.)
 * - Values: Quantities
 * - Grand Total column and Total row
 */
router.post('/download', async (req, res) => {
  try {
    const { storeName, courierName, dateFrom, dateTo } = req.body;
    
    // Build query to get all products with courier quantities
    let query = `
      SELECT 
        courier_name,
        product_name,
        SUM(quantity) as quantity
      FROM labels
      WHERE 1=1
    `;
    
    const params = [];
    
    if (storeName) {
      query += ` AND store_name = ?`;
      params.push(storeName);
    }
    
    if (courierName) {
      query += ` AND courier_name = ?`;
      params.push(courierName);
    }
    
    if (dateFrom) {
      query += ` AND label_date >= ?`;
      params.push(dateFrom);
    }
    
    if (dateTo) {
      const endDate = new Date(dateTo);
      endDate.setHours(23, 59, 59, 999);
      query += ` AND label_date <= ?`;
      params.push(endDate.toISOString());
    }
    
    query += ` GROUP BY courier_name, product_name ORDER BY product_name, courier_name`;
    
    const [results] = await pool.execute(query, params);
    
    // Get unique couriers and products
    const couriers = [...new Set(results.map(r => r.courier_name))].sort();
    const products = [...new Set(results.map(r => r.product_name))].sort();
    
    // Build pivot table data structure
    // Map: product_name -> { courier_name: quantity }
    const pivotData = {};
    results.forEach(row => {
      if (!pivotData[row.product_name]) {
        pivotData[row.product_name] = {};
      }
      pivotData[row.product_name][row.courier_name] = Number(row.quantity);
    });
    
    // Generate Excel workbook
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Pick List');
    
    // Set column definitions
    const columns = [
      { key: 'product', header: 'Product Name', width: 45 }
    ];
    
    // Add courier columns dynamically
    couriers.forEach(courier => {
      columns.push({ key: courier, header: courier, width: 15 });
    });
    
    // Add Grand Total column
    columns.push({ key: 'grandTotal', header: 'Grand Total', width: 15 });
    
    worksheet.columns = columns;
    
    // Style header row
    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE0E0E0' }
      };
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      };
      cell.alignment = { horizontal: 'center' };
    });
    
    // Add product rows
    const courierTotals = {};
    couriers.forEach(c => courierTotals[c] = 0);
    let grandTotalSum = 0;
    
    products.forEach(product => {
      const rowData = { product };
      let rowTotal = 0;
      
      couriers.forEach(courier => {
        const qty = pivotData[product][courier] || 0;
        rowData[courier] = qty || '';  // Empty string if 0 for cleaner look
        if (qty > 0) {
          rowData[courier] = qty;
          courierTotals[courier] += qty;
          rowTotal += qty;
        }
      });
      
      rowData.grandTotal = rowTotal;
      grandTotalSum += rowTotal;
      
      const row = worksheet.addRow(rowData);
      row.eachCell((cell, colNumber) => {
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
        // Center align quantity columns
        if (colNumber > 1) {
          cell.alignment = { horizontal: 'center' };
        }
      });
    });
    
    // Add Total row
    const totalRowData = { product: 'Total' };
    couriers.forEach(courier => {
      totalRowData[courier] = courierTotals[courier];
    });
    totalRowData.grandTotal = grandTotalSum;
    
    const totalRow = worksheet.addRow(totalRowData);
    totalRow.font = { bold: true };
    totalRow.eachCell((cell, colNumber) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFFFEB9C' }  // Light yellow
      };
      cell.border = {
        top: { style: 'medium' },
        left: { style: 'thin' },
        bottom: { style: 'medium' },
        right: { style: 'thin' }
      };
      if (colNumber > 1) {
        cell.alignment = { horizontal: 'center' };
      }
    });
    
    // Generate buffer and send
    const buffer = await workbook.xlsx.writeBuffer();
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=picklist_${Date.now()}.xlsx`);
    res.send(buffer);
    
  } catch (error) {
    console.error('Error downloading pick list:', error);
    res.status(500).json({ error: 'Failed to download pick list' });
  }
});

module.exports = router;
