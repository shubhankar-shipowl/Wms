# WMS Application – User Guide

This guide explains how to use the Warehouse Management System (WMS) web app to manage products, barcodes, inventory, transactions, and reports.

## 1. Getting Started

- Open the web app in your browser.
- Log in with your username and password.
- If your session expires, you’ll be asked to log in again.

Roles and access:

- Admin/Manager: full access to manage products, barcodes, inventory, and settings.
- User: limited access based on permissions configured by admin.

## 2. Navigation Overview

Main sections:

- Dashboard: key stats and trends.
- Products: create/manage products and barcodes.
- Barcodes: list, search, print, and manage barcodes.
- Inventory: stock levels, low stock view, stock in/out.
- Transactions: history of stock movements.
- Reports: exportable summaries.
- Settings: printer settings and app preferences.

## 3. Products

Create and manage product information.

Add a product:

1. Go to Products → Add Product.
2. Fill in name, SKU, price, category, unit, HSN, GST rate, and status.
3. Optionally upload images.
4. Save.

Edit a product:

1. Open Products and select a product.
2. Click Edit, update fields, and Save.

View product details:

- Shows current stock, barcode count, recent transactions, and images.

## 4. Barcodes

Manage barcodes linked to products.

Generate barcodes:

1. Go to Barcodes → Generate Barcodes.
2. Select a product and enter quantity (max 1000 per batch).
3. Submit to generate.

Search/filter barcodes:

- Use search box (barcode, product name, SKU) and product filter.
- Adjust page size as needed.

Print barcodes:

- Print a single barcode: use the print icon on a row.
- Print filtered list: use Print All.
- Direct print (server-side) is supported for thermal printers and can generate files/PDF depending on server configuration.

Delete barcodes:

- Use the delete icon on a row (admin only).

Preview barcode:

- Use the preview icon to view a larger image with details.

Notes:

- Barcodes are independent identifiers; stock linkage is controlled via “stocked in” and units.

## 5. Inventory

Track and update stock.

Stock in/out (product-level):

1. Go to Products or Inventory → Update Stock.
2. Choose type (in/out), quantity, and optional notes.
3. Save.

Stock via barcodes (barcode-level stocking):

- Each barcode has fields: is_stocked_in (0/1) and units_assigned.
- To reflect physical stock per barcode, mark barcodes as stocked in and set units_assigned (commonly 1).
- Product stock is synchronized by summing units_assigned for stocked-in barcodes (or directly updated based on operations).

Low stock view:

- Inventory page can filter to show items at/below thresholds.

## 6. Barcode Scanner

- Navigate to Barcode Scanner.
- Scan or input a barcode to fetch product/stock info.
- The app records scan-related transactions if configured.

## 7. Transactions

- View all stock movement records.
- Filter by date, product, or type (in/out).
- Each transaction includes quantity, reference number, notes, and user.

## 8. Reports

- Access Reports for summaries (stock, movements, valuations) and exports.
- Choose date ranges and export formats if available.

## 9. Printing (Thermal and Standard)

- Thermal label (50mm x 25mm) and A4 layouts are supported.
- Direct print endpoint sends labels via server using configured printer modes (TSPL/TSC, CUPS, or file/PDF generation).
- Ensure popups are allowed if using browser-based print.
- If direct print is enabled, the app will attempt server-side printing for better performance.

Tips:

- For bulk printing existing barcodes for a product, use Barcodes → filter by product → Print All.
- If you need to print a specific set, select rows or trigger print from product details if available.

## 10. Settings and Printer

- Settings allow configuring printer connection type (e.g., CUPS, USB, file/PDF).
- Use “Test Printer” to verify connectivity.
- “Printer Queue” shows current print jobs and printer status (server-side).

## 11. Realtime Updates

- The app uses realtime updates for products, stock changes, and transactions.
- Data automatically refreshes on relevant events.

## 12. Common Workflows

A) Receive new stock using barcodes you already generated:

1. Go to Barcodes and locate product’s barcodes.
2. Mark the corresponding barcodes as stocked in (units_assigned = 1) in bulk (admin-only tools/scripts) or via operations provided.
3. Confirm product stock reflects the sum of stocked-in barcode units.

B) Generate new barcodes and print labels:

1. Barcodes → Generate → select product and quantity.
2. After success, open Print dialog.
3. Choose Thermal/Standard and print (or direct print if enabled).

C) Adjust stock without barcodes:

1. Products/Inventory → Update Stock.
2. Choose in/out, set quantity and notes, Save.

## 13. Troubleshooting

- Login issues: Verify credentials; session may have expired—log in again.
- Printer not responding: Use Settings → Test Printer; check printer queue; verify connection type and drivers on the server.
- Popups blocked: Allow popups for the app when using browser print.
- Barcode not found: Ensure the barcode exists and belongs to the correct product.
- Slow bulk actions: Large operations (e.g., >1000) may take time. Use smaller batches.

## 14. FAQ

- Q: Can I print labels directly to a thermal printer?
  - A: Yes, enable direct print (server-side). Otherwise, print via browser.
- Q: How is product stock calculated?
  - A: Either via barcode-level stocking (sum of units_assigned where stocked in) or product-level stock updates—your workflow dictates which controls the source of truth.
- Q: Can I export reports?
  - A: Yes, from the Reports section when enabled.

## 15. Support

- For access changes or role updates, contact an admin.
- For printer configuration or integration issues, contact the system maintainer.

---

## 16. Quick Start (New Users)

1. Log in and open Dashboard to confirm access.
2. Go to Products and search your item by name or SKU.
3. If product is missing, click Add Product and create it.
4. Go to Barcodes and generate required labels, or stock-in existing barcodes.
5. Print labels (Thermal recommended) and apply them to items.
6. Use Inventory to verify stock counts.
7. Record stock movements under Transactions when items go in/out.

## 17. Permissions (Overview)

- Admin: full access, including delete and settings.
- Manager: create/update products, generate/print barcodes, stock operations.
- User: view, limited stock operations (as configured), no destructive admin actions.

If you see “permission denied,” contact an admin to adjust your role.

## 18. Printer Setup (First Time)

1. Open Settings → Printer.
2. Select connection type:
   - TSPL/TSC USB (direct thermal printer)
   - CUPS (Linux/macOS print system)
   - File/PDF (save label commands or PDF for download)
3. Click Test Printer to confirm connectivity.
4. In Barcodes, print a single label as a test.
5. If label alignment is off, adjust size/gap/density in Settings and retry.

Troubleshooting tips:

- Ensure the printer is powered, connected, and selected as default (for CUPS).
- Use high-quality labels compatible with CODE128.
- Check that the browser allows popups if using browser print.

## 19. Data Model Basics (What you’re editing)

- Product: name, SKU, price, stock_quantity, etc.
- Barcode: belongs to a product; fields include barcode (CODE128), units_assigned, is_stocked_in.
- Inventory/Transactions: record stock in/out, quantities, notes, and user.

Two common workflows:

- Barcode-driven stock: stock is the sum of units_assigned for barcodes marked is_stocked_in.
- Product-driven stock: update stock_quantity directly via Inventory actions.

## 20. Step-by-Step Examples

A) Receive 50 units with existing barcodes:

1. Barcodes → filter by product.
2. Select or bulk-mark 50 barcodes as stocked in (units_assigned = 1).
3. Verify product stock reflects 50 additional units.

B) Print 100 new labels:

1. Barcodes → Generate Barcodes → select product → quantity 100.
2. After generation, open the print dialog.
3. Choose Thermal and Print (or use direct print if configured).

C) Adjust stock without barcodes (e.g., audit correction):

1. Inventory → Update Stock → type = in/out → enter quantity.
2. Add a note for audit trail, Save.

## 21. Barcode Best Practices

- Keep units_assigned = 1 per label for single-unit items.
- For multi-pack items, set units_assigned accordingly and be consistent.
- Avoid duplicating barcodes; use search before creating new ones.
- Periodically archive or delete unused barcodes (admin only).

## 22. Keyboard & Usability Tips

- Use the search box in Products/Barcodes to quickly filter by SKU or name.
- Pagination controls help load large lists faster (10/20/50/100 per page).
- When printing from browser, set scale to 100% and margins to none.

## 23. Safety & Audit

- Use notes on stock movements to leave a clear audit trail.
- Prefer barcode-level stocking for traceability of individual items.
- Deleting barcodes is permanent (admin-only); double-check before confirming.

## 24. FAQ (Extended)

- Q: My printed barcode is blurry.
  - A: Reduce speed or increase density in printer settings; use better label media.
- Q: The barcode number doesn’t scan.
  - A: Ensure CODE128 is used and human-readable text matches the barcode data.
- Q: I printed but nothing came out.
  - A: Check printer mode (CUPS vs USB vs File/PDF), queue status, and cables.
- Q: Can I export product/barcode lists?
  - A: Use Reports; if you need a custom export, ask an admin.

---

This guide covers day-to-day usage. For deployment or developer setup, see README.md and ENVIRONMENT_SETUP.md.
