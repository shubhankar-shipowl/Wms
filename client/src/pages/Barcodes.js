import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Box,
  Typography,
  Grid,
  Card,
  CardContent,
  TextField,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  IconButton,
  InputAdornment,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Alert,
  LinearProgress,
  Pagination,
  Autocomplete,
} from '@mui/material';
import {
  Search,
  Refresh,
  Add,
  Delete,
  Visibility,
  Print,
  PrintOutlined,
  QrCode,
} from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import axios from 'axios';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import JsBarcode from 'jsbarcode';
import { jsPDF } from 'jspdf';
import LoadingSpinner from '../components/Common/LoadingSpinner';
import { useAuth } from '../contexts/AuthContext';

// Utility: Download barcodes as PDF (one barcode per page)
// Layout matches the thermal print function: SKU → Barcode → Barcode Number (no product name)
const downloadBarcodePDF = (barcodes, product) => {
  const pdf = new jsPDF('l', 'mm', [50, 25]); // Landscape, 50mm x 25mm label size
  const pageW = 50;

  barcodes.forEach((barcode, index) => {
    if (index > 0) {
      pdf.addPage([50, 25], 'l');
    }

    // SKU (top, matching print function)
    pdf.setFontSize(7);
    pdf.setFont(undefined, 'bold');
    pdf.text(`SKU: ${product?.sku || 'N/A'}`, pageW / 2, 4, {
      align: 'center',
    });

    // Generate barcode image (center)
    const barcodeNumber =
      typeof barcode === 'string' ? barcode : barcode.barcode;
    const canvas = document.createElement('canvas');
    try {
      JsBarcode(canvas, barcodeNumber, {
        format: 'CODE128',
        width: 2,
        height: 40,
        displayValue: false,
        margin: 0,
      });
      const imgData = canvas.toDataURL('image/png');
      pdf.addImage(imgData, 'PNG', 3, 7, pageW - 6, 11);
    } catch (err) {
      console.error('PDF barcode generation error:', err);
    }

    // Barcode number text (below barcode)
    pdf.setFontSize(7);
    pdf.setFont('courier', 'bold');
    pdf.text(barcodeNumber, pageW / 2, 23, { align: 'center' });
  });

  const fileName = `barcodes_${product?.sku || 'unknown'}_${new Date().toISOString().split('T')[0]}.pdf`;
  pdf.save(fileName);
};

const BarcodeGenerationDialog = ({
  open,
  onClose,
  onSuccess,
  onPrintGenerated,
}) => {
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [quantity, setQuantity] = useState(1);
  const queryClient = useQueryClient();

  // Get products for selection - refetch when dialog opens
  // Fetch all products without pagination for dropdown
  const {
    data: productsData,
    isLoading: productsLoading,
    error: productsError,
    refetch,
  } = useQuery(
    'products-for-barcode-generation',
    () => axios.get('/api/products?all=true').then((res) => res.data),
    {
      enabled: open, // Only fetch when dialog is open
      staleTime: 0, // Always consider data stale
      refetchOnWindowFocus: false, // Prevent unnecessary refetches
    },
  );

  const products = productsData?.data?.products || [];

  // Refetch products when dialog opens
  useEffect(() => {
    if (open) {
      refetch();
      setSelectedProduct(null); // Reset selected product
    }
  }, [open, refetch]);

  const generateBarcodesMutation = useMutation(
    (data) =>
      axios.post('/api/barcodes/generate', data, {
        timeout: 120000, // 2 minutes timeout for barcode generation
      }),
    {
      onSuccess: (response) => {
        const generatedCount =
          response.data.data.quantity || response.data.data.generated_count;
        const productName = selectedProduct?.name || 'Unknown Product';

        toast.success(
          `Successfully generated ${generatedCount} barcodes for ${productName}. Opening print dialog...`,
        );

        // Invalidate all products queries to refresh the dropdown and products page
        queryClient.invalidateQueries('products');
        queryClient.invalidateQueries(['products']);
        queryClient.invalidateQueries('products-filter');
        // Invalidate all products queries with any parameters using a predicate
        queryClient.invalidateQueries({
          predicate: (query) => {
            return query.queryKey[0] === 'products';
          },
        });

        // Close generation dialog first
        onClose();
        setSelectedProduct(null);
        setQuantity(1);

        // Download barcodes as PDF
        if (response.data.data.barcodes) {
          downloadBarcodePDF(response.data.data.barcodes, selectedProduct);
        }

        // Trigger print dialog with generated barcodes after a short delay
        if (onPrintGenerated && response.data.data.barcodes) {
          console.log(
            'Triggering print for generated barcodes:',
            response.data.data.barcodes.length,
          );
          setTimeout(() => {
            onPrintGenerated(response.data.data.barcodes, selectedProduct);
          }, 500);
        }

        onSuccess();
      },
      onError: (error) => {
        console.error('Barcode generation error:', error);
        if (error.code === 'ECONNABORTED') {
          toast.error(
            'Barcode generation timed out. Please try with a smaller quantity.',
          );
        } else if (error.response?.status === 401) {
          toast.error('Session expired. Please login again.');
        } else {
          toast.error(
            error.response?.data?.error ||
              error.response?.data?.message ||
              'Failed to generate barcodes',
          );
        }
      },
    },
  );

  const handleGenerate = () => {
    if (!selectedProduct || quantity < 1) {
      toast.error('Please select a product and specify quantity');
      return;
    }

    const requestedQuantity = parseInt(quantity);

    if (requestedQuantity > 1000) {
      toast.error('Maximum 1000 barcodes can be generated at once');
      return;
    }

    generateBarcodesMutation.mutate({
      product_id: selectedProduct.id,
      quantity: requestedQuantity,
    });
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Generate Barcodes</DialogTitle>
      <DialogContent>
        <Box sx={{ mt: 2 }}>
          {/* Product Select with Built-in Search */}
          <Autocomplete
            options={products}
            getOptionLabel={(option) => option.name || ''}
            value={selectedProduct}
            onChange={(event, newValue) => {
              setSelectedProduct(newValue);
            }}
            loading={productsLoading}
            disabled={productsLoading}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Select Product"
                placeholder="Search by product name or SKU..."
                InputProps={{
                  ...params.InputProps,
                  startAdornment: (
                    <>
                      <InputAdornment position="start">
                        <Search color="action" />
                      </InputAdornment>
                      {params.InputProps.startAdornment}
                    </>
                  ),
                }}
              />
            )}
            renderOption={(props, product) => (
              <Box component="li" {...props} key={product.id}>
                <Box>
                  <Typography variant="body1">{product.name}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    SKU: {product.sku} | Stock: {product.total_stock || 0}
                  </Typography>
                </Box>
              </Box>
            )}
            filterOptions={(options, { inputValue }) => {
              if (!inputValue) {
                return options;
              }
              const searchLower = inputValue.toLowerCase();
              return options.filter(
                (product) =>
                  product.name.toLowerCase().includes(searchLower) ||
                  product.sku.toLowerCase().includes(searchLower)
              );
            }}
            noOptionsText={
              productsLoading
                ? 'Loading products...'
                : productsError
                ? 'Error loading products'
                : 'No products found'
            }
            isOptionEqualToValue={(option, value) => option.id === value.id}
          />

          <TextField
            fullWidth
            label="Number of Barcodes"
            type="number"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            sx={{ mt: 3 }}
            inputProps={{
              min: 1,
              max: 1000,
            }}
            helperText="Enter the number of barcodes to generate (max 1000)"
          />

          {selectedProduct && (
            <Alert severity="info" sx={{ mt: 2 }}>
              <Typography variant="body2">
                Product: {selectedProduct.name} ({selectedProduct.sku})
                <br />
                Current Stock: {selectedProduct.total_stock || 0} units
                <br />
                Barcodes to Generate: {quantity}
              </Typography>
            </Alert>
          )}

          {generateBarcodesMutation.isLoading && (
            <Box sx={{ mt: 2 }}>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                Generating {quantity} barcodes... This may take a moment for
                large quantities.
              </Typography>
              <LinearProgress sx={{ mt: 1 }} />
            </Box>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          onClick={handleGenerate}
          variant="contained"
          disabled={
            !selectedProduct ||
            quantity < 1 ||
            generateBarcodesMutation.isLoading
          }
        >
          {generateBarcodesMutation.isLoading
            ? 'Generating...'
            : `Generate ${quantity} Barcode${quantity > 1 ? 's' : ''}`}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

// Barcode Print Dialog Component
const BarcodePrintDialog = ({
  open,
  onClose,
  barcodes,
  product,
  autoPrint = false,
  directPrint = false,
}) => {
  const [printFormat, setPrintFormat] = useState('thermal');
  const [copies, setCopies] = useState(1);
  const hasPrintedRef = useRef(false);

  const generateBarcodeSVG = (barcodeNumber) => {
    const canvas = document.createElement('canvas');

    try {
      JsBarcode(canvas, barcodeNumber, {
        format: 'CODE128',
        width: 2, // Reduced for 50mm width
        height: 30, // Optimized for 25mm thermal label
        displayValue: false, // Don't show barcode number in image since we show it separately
        margin: 0,
      });
      return canvas.toDataURL('image/png');
    } catch (error) {
      console.error('Barcode generation error:', error);
      return null;
    }
  };

  // Direct print function - server-side printing
  const handleDirectPrint = useCallback(async () => {
    console.log('Direct printing', barcodes.length, 'barcodes');
    console.log(
      'Barcodes to print:',
      barcodes.map((b) => b.barcode),
    );
    console.log('directPrint prop:', directPrint);

    try {
      // Send all barcodes in a single request for better performance
      const response = await fetch('/api/direct-print/print-barcodes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          productId: product?.id,
          quantity: barcodes.length,
          existingBarcodes: barcodes.map((b) => b.barcode), // Send all barcode numbers at once
        }),
      });

      const result = await response.json();
      console.log('Print response:', result);

      if (result.success) {
        if (result.fileMode) {
          toast.success(
            `${barcodes.length} barcode(s) printed successfully (saved to file)`,
          );
        } else if (result.cupsMode) {
          const message = result.jobId
            ? `${barcodes.length} barcode(s) printed successfully via CUPS (Job ID: ${result.jobId})`
            : `${barcodes.length} barcode(s) printed successfully via CUPS`;
          toast.success(message);
        } else if (result.vpsMode) {
          toast.success(`${barcodes.length} barcode(s) generated as PDF`);
        } else {
          toast.success(`${barcodes.length} barcode(s) printed successfully`);
        }
        onClose();
      } else {
        toast.error(result.error || 'Failed to print barcodes');
      }
    } catch (error) {
      console.error('Direct print error:', error);
      toast.error('Failed to print barcodes. Please try again.');
    }
  }, [barcodes, product, onClose, directPrint]);

  const handlePrint = useCallback(() => {
    console.log('Starting print process for', barcodes.length, 'barcodes');

    // For direct print, try to print without opening a new window
    if (directPrint) {
      handleDirectPrint();
      return;
    }

    const printWindow = window.open('', '_blank');

    if (!printWindow) {
      console.error('Failed to open print window - popup blocked?');
      toast.error('Print window blocked. Please allow popups and try again.');
      return;
    }

    let printContent = '';

    if (printFormat === 'thermal') {
      // Thermal printer format (50mm x 25mm)
      printContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>Barcode Labels</title>
          <style>
            @page { 
              size: 50mm 25mm; 
              margin: 0; 
            }
            @media print {
              body { margin: 0; padding: 0; }
              .label { page-break-inside: avoid; }
            }
            body { 
              margin: 0; 
              padding: 1mm; 
              font-family: Arial, sans-serif; 
              font-size: 8px;
            }
            .label { 
              width: 48mm; 
              height: 23mm;  // Fixed height for 25mm label
              border: 1px solid #000; 
              padding: 1mm; 
              margin-bottom: 1mm; 
              text-align: center;
              display: flex;
              flex-direction: column;
              justify-content: space-between;
              overflow: hidden;
              box-sizing: border-box;
            }
            .label-header {
              flex-shrink: 0;
              height: 2.5mm;
            }
            .barcode-section {
              flex: 1;
              display: flex;
              flex-direction: column;
              justify-content: flex-start;
              align-items: center;
              min-height: 0;
              overflow: hidden;
              padding-top: 0.5mm;
            }
            .barcode-img { 
              max-width: 100%; 
              height: auto; 
              max-height: 12mm;
              margin: 0; 
              flex-shrink: 0;
            }
            .barcode-number {
              font-size: 6px;
              font-family: monospace;
              font-weight: bold;
              margin: 0; 
              text-align: center;
              word-break: break-all;
              color: #333;
              flex-shrink: 0;
            }
            .product-name { 
              font-size: 5px; 
              margin: 0; 
              word-wrap: break-word;
              flex-shrink: 0;
              line-height: 1;
              font-weight: bold;
            }
            .sku { 
              font-size: 4px; 
              color: #666; 
              margin: 0;
              flex-shrink: 0;
              line-height: 1;
            }
          </style>
        </head>
        <body>
          ${barcodes
            .map((barcode) => {
              const barcodeDataURL = generateBarcodeSVG(barcode.barcode);
              return `
              <div class="label">
                <div class="label-header">
                  <div class="product-name">${product?.name || 'Product'}</div>
                  <div class="sku">SKU: ${product?.sku || 'N/A'}</div>
                </div>
                <div class="barcode-section">
                  ${
                    barcodeDataURL
                      ? `<img src="${barcodeDataURL}" alt="Barcode" class="barcode-img" />`
                      : ''
                  }
                  <div class="barcode-number">${barcode.barcode}</div>
                </div>
              </div>
            `;
            })
            .join('')}
        </body>
        </html>
      `;
    } else {
      // Standard printer format (A4)
      printContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>Barcode Labels</title>
          <style>
            @page { 
              size: A4; 
              margin: 10mm; 
            }
            body { 
              margin: 0; 
              padding: 0; 
              font-family: Arial, sans-serif; 
            }
            .label { 
              width: 50mm;  // Increased from 45mm
              height: 35mm; // Increased from 25mm to accommodate larger barcode
              border: 1px solid #000; 
              padding: 3mm; 
              margin: 2mm; 
              display: inline-block; 
              vertical-align: top;
              text-align: center;
            }
            .barcode-img { 
              max-width: 100%; 
              height: auto; 
              margin: 0 0 1mm 0;  // Small bottom margin before barcode number
            }
            .barcode-number {
              font-size: 10px;
              font-family: monospace;
              font-weight: bold;
              margin: 0 0 2mm 0;  // No top margin, small bottom margin
              text-align: center;
              word-break: break-all;
              color: #333;
            }
            .product-name { 
              font-size: 10px; 
              margin: 1mm 0; 
              word-wrap: break-word;
            }
            .sku { 
              font-size: 8px; 
              color: #666; 
              margin: 1mm 0;
            }
          </style>
        </head>
        <body>
          ${barcodes
            .map((barcode) => {
              const barcodeDataURL = generateBarcodeSVG(barcode.barcode);
              return `
              <div class="label">
                <div class="label-header">
                  <div class="product-name">${product?.name || 'Product'}</div>
                  <div class="sku">SKU: ${product?.sku || 'N/A'}</div>
                </div>
                <div class="barcode-section">
                  ${
                    barcodeDataURL
                      ? `<img src="${barcodeDataURL}" alt="Barcode" class="barcode-img" />`
                      : ''
                  }
                  <div class="barcode-number">${barcode.barcode}</div>
                </div>
              </div>
            `;
            })
            .join('')}
        </body>
        </html>
      `;
    }

    try {
      printWindow.document.write(printContent);
      printWindow.document.close();
      printWindow.focus();

      // Wait for content to load before printing
      printWindow.onload = () => {
        console.log('Print window loaded, triggering print...');
        printWindow.print();

        // Close window after a short delay
        setTimeout(() => {
          printWindow.close();
        }, 1000);
      };

      // Fallback: print immediately if onload doesn't fire
      setTimeout(() => {
        if (!printWindow.closed) {
          console.log('Fallback: triggering print after timeout...');
          printWindow.print();
          setTimeout(() => printWindow.close(), 1000);
        }
      }, 2000);

      toast.success(`${barcodes.length} barcode(s) sent to printer`);
      onClose();
    } catch (error) {
      console.error('Print error:', error);
      toast.error('Failed to print barcodes. Please try again.');
      printWindow.close();
    }
  }, [printFormat, barcodes, product, onClose, directPrint, handleDirectPrint]);

  // Auto-print effect
  useEffect(() => {
    if (
      autoPrint &&
      open &&
      barcodes &&
      barcodes.length > 0 &&
      !hasPrintedRef.current
    ) {
      hasPrintedRef.current = true; // Mark as printed to prevent multiple prints

      // Small delay to ensure dialog is fully loaded
      setTimeout(() => {
        console.log(
          'Auto-printing barcodes:',
          barcodes.length,
          'for product:',
          product?.name,
        );
        console.log('directPrint value:', directPrint);
        console.log('autoPrint value:', autoPrint);
        if (directPrint) {
          console.log('Calling handleDirectPrint');
          handleDirectPrint();
        } else {
          console.log('Calling handlePrint');
          handlePrint();
        }

        // If direct print, close dialog immediately after printing
        if (directPrint) {
          setTimeout(() => {
            onClose();
          }, 2000); // Close after 2 seconds
        }
      }, 1000);
    }
  }, [
    autoPrint,
    open,
    barcodes,
    directPrint,
    onClose,
    handleDirectPrint,
    handlePrint,
    product?.name,
  ]);

  // Reset the printed flag when dialog closes
  useEffect(() => {
    if (!open) {
      hasPrintedRef.current = false;
    }
  }, [open]);

  // For direct print, show minimal dialog or no dialog at all
  if (directPrint && autoPrint) {
    return (
      <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
        <DialogContent>
          <Box sx={{ textAlign: 'center', py: 4 }}>
            <LoadingSpinner message="Printing barcodes directly..." />
            <Typography variant="body2" sx={{ mt: 2, color: 'text.secondary' }}>
              {barcodes.length} barcode(s) for {product?.name} are being printed
            </Typography>
          </Box>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        {autoPrint ? 'Auto-Printing Barcodes' : 'Print Barcodes'}
      </DialogTitle>
      <DialogContent>
        <Box sx={{ mt: 2 }}>
          {autoPrint ? (
            <Box sx={{ textAlign: 'center', py: 2 }}>
              <LoadingSpinner message="Preparing barcodes for printing..." />
              <Typography
                variant="body2"
                sx={{ mt: 2, color: 'text.secondary' }}
              >
                {barcodes.length} barcode(s) for {product?.name} will be printed
                automatically
              </Typography>
            </Box>
          ) : (
            <Typography variant="h6" gutterBottom>
              Print {barcodes.length} barcode(s) for {product?.name}
            </Typography>
          )}

          {!autoPrint && (
            <>
              <FormControl fullWidth sx={{ mt: 2, mb: 2 }}>
                <InputLabel>Printer Type</InputLabel>
                <Select
                  value={printFormat}
                  onChange={(e) => setPrintFormat(e.target.value)}
                  label="Printer Type"
                >
                  <MenuItem value="thermal">
                    Thermal Printer (50mm x 25mm)
                  </MenuItem>
                  <MenuItem value="standard">Standard Printer (A4)</MenuItem>
                </Select>
              </FormControl>

              <TextField
                fullWidth
                label="Number of Copies"
                type="number"
                value={copies}
                onChange={(e) => setCopies(parseInt(e.target.value) || 1)}
                inputProps={{ min: 1, max: 10 }}
                sx={{ mb: 2 }}
              />

              <Alert severity="info" sx={{ mt: 2 }}>
                <Typography variant="body2">
                  {printFormat === 'thermal'
                    ? 'Thermal printer format optimized for 50mm x 25mm thermal labels. Make sure your printer is connected and ready.'
                    : 'Standard printer format for A4 paper. Labels will be arranged in a grid layout.'}
                </Typography>
              </Alert>
            </>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button onClick={handlePrint} variant="contained" startIcon={<Print />}>
          {autoPrint ? 'Print Now' : 'Print Barcodes'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

// Helper function to generate barcode image for display
const generateBarcodeImage = (barcodeNumber) => {
  const canvas = document.createElement('canvas');
  try {
    JsBarcode(canvas, barcodeNumber, {
      format: 'CODE128',
      width: 2, // Smaller width for UI display
      height: 40, // Smaller height for UI display
      displayValue: true, // Keep displayValue for UI preview
      margin: 2,
      fontSize: 8,
    });
    return canvas.toDataURL('image/png');
  } catch (error) {
    console.error('Barcode generation error:', error);
    return null;
  }
};

const Barcodes = () => {
  const [search, setSearch] = useState('');
  const [selectedProduct, setSelectedProduct] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [stockStatusFilter, setStockStatusFilter] = useState(''); // '', 'in', 'out'
  const [generateDialogOpen, setGenerateDialogOpen] = useState(false);
  const [selectedBarcode, setSelectedBarcode] = useState(null);
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [printDialogOpen, setPrintDialogOpen] = useState(false);
  const [selectedBarcodesForPrint, setSelectedBarcodesForPrint] = useState([]);
  const [selectedProductForPrint, setSelectedProductForPrint] = useState(null);
  const [previewDialogOpen, setPreviewDialogOpen] = useState(false);
  const [selectedBarcodeForPreview, setSelectedBarcodeForPreview] =
    useState(null);
  const { canEdit, canManageBarcodes, canDeleteBarcodes } = useAuth();
  const queryClient = useQueryClient();

  // Get barcodes with filtering and pagination
  const {
    data: barcodesData,
    isLoading,
    refetch,
  } = useQuery(
    ['barcodes', search, selectedProduct, page, limit, stockStatusFilter],
    () => {
      return axios
        .get('/api/barcodes', {
          params: {
            search,
            product_id: selectedProduct,
            page,
            limit,
            stock_status: stockStatusFilter || undefined,
          },
        })
        .then((res) => res.data);
    },
    {
      keepPreviousData: true,
    },
  );

  // Get products for filter dropdown
  const { data: productsData } = useQuery('products', () =>
    axios.get('/api/products?limit=1000').then((res) => res.data),
  );

  const barcodes = barcodesData?.data?.barcodes || [];
  const pagination = barcodesData?.data?.pagination || {};
  const products = productsData?.data?.products || [];

  // Apply client-side stock status filtering without backend changes
  // With server-side filtering enabled, we can use data directly
  const filteredBarcodes = barcodes;

  const deleteBarcodeMutation = useMutation(
    (barcodeId) => axios.delete(`/api/barcodes/${barcodeId}`),
    {
      onSuccess: () => {
        toast.success('Barcode deleted successfully');
        queryClient.invalidateQueries('barcodes');
        // Also invalidate products queries to update barcode count
        queryClient.invalidateQueries('products');
        queryClient.invalidateQueries(['products']);
        queryClient.invalidateQueries('products-filter');
        // Invalidate all products queries with any parameters using a predicate
        queryClient.invalidateQueries({
          predicate: (query) => {
            return query.queryKey[0] === 'products';
          },
        });
      },
      onError: (error) => {
        toast.error(
          error.response?.data?.message || 'Failed to delete barcode',
        );
      },
    },
  );

  const handleDeleteBarcode = (barcodeId) => {
    if (window.confirm('Are you sure you want to delete this barcode?')) {
      deleteBarcodeMutation.mutate(barcodeId);
    }
  };

  const handleViewDetails = (barcode) => {
    setSelectedBarcode(barcode);
    setDetailDialogOpen(true);
  };

  const handleRefresh = () => {
    refetch();
  };

  const handlePrintBarcodes = (barcode = null) => {
    if (barcode) {
      // Print single barcode
      setSelectedBarcodesForPrint([barcode]);
      setSelectedProductForPrint(
        products.find((p) => p.id === barcode.product_id),
      );
    } else {
      // Print all barcodes currently visible after filters
      setSelectedBarcodesForPrint(filteredBarcodes);
      setSelectedProductForPrint(null);
    }
    setPrintDialogOpen(true);
  };

  const handlePrintGeneratedBarcodes = (generatedBarcodes, product) => {
    // Convert string array to object array format expected by print dialog
    const barcodeObjects = generatedBarcodes.map((barcodeString) => ({
      barcode: barcodeString,
      product_id: product?.id,
    }));

    setSelectedBarcodesForPrint(barcodeObjects);
    setSelectedProductForPrint(product);
    setPrintDialogOpen(true);
  };

  const handlePreviewBarcode = (barcode) => {
    setSelectedBarcodeForPreview(barcode);
    setPreviewDialogOpen(true);
  };

  if (isLoading) {
    return <LoadingSpinner message="Loading barcodes..." />;
  }

  return (
    <Box>
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          mb: 3,
        }}
      >
        <Typography variant="h4" component="h1">
          Barcode Management
        </Typography>
        <Box sx={{ display: 'flex', gap: 2 }}>
          {canManageBarcodes && (
            <Button
              variant="contained"
              startIcon={<Add />}
              onClick={() => setGenerateDialogOpen(true)}
            >
              Generate Barcodes
            </Button>
          )}
          {filteredBarcodes.length > 0 && (
            <Button
              variant="outlined"
              startIcon={<Print />}
              onClick={() => handlePrintBarcodes()}
              color="primary"
            >
              Print All ({filteredBarcodes.length})
            </Button>
          )}
          <Button
            variant="outlined"
            startIcon={<Refresh />}
            onClick={handleRefresh}
          >
            Refresh
          </Button>
        </Box>
      </Box>

      {/* Filters */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6} md={4}>
              <TextField
                fullWidth
                label="Search Barcodes"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1); // Reset to first page when searching
                }}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <Search />
                    </InputAdornment>
                  ),
                }}
                placeholder="Search by barcode number..."
              />
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <FormControl fullWidth>
                <InputLabel>Filter by Product</InputLabel>
                <Select
                  value={selectedProduct}
                  onChange={(e) => {
                    setSelectedProduct(e.target.value);
                    setPage(1); // Reset to first page when filtering
                  }}
                  label="Filter by Product"
                >
                  <MenuItem value="">All Products</MenuItem>
                  {products.map((product) => (
                    <MenuItem key={product.id} value={product.id}>
                      {product.name} ({product.sku})
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <FormControl fullWidth>
                <InputLabel>Transaction Type</InputLabel>
                <Select
                  value={stockStatusFilter}
                  onChange={(e) => {
                    setStockStatusFilter(e.target.value);
                    setPage(1);
                  }}
                  label="Transaction Type"
                >
                  <MenuItem value="">All Types</MenuItem>
                  <MenuItem value="in">Stock IN</MenuItem>
                  <MenuItem value="out">Stock OUT</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={6} md={2}>
              <FormControl fullWidth>
                <InputLabel>Show Per Page</InputLabel>
                <Select
                  value={limit}
                  onChange={(e) => {
                    setLimit(e.target.value);
                    setPage(1); // Reset to first page when changing limit
                  }}
                  label="Show Per Page"
                >
                  <MenuItem value={10}>10</MenuItem>
                  <MenuItem value={20}>20</MenuItem>
                  <MenuItem value={50}>50</MenuItem>
                  <MenuItem value={100}>100</MenuItem>
                </Select>
              </FormControl>
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      {/* Barcodes Table */}
      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Barcode</TableCell>
              <TableCell>Product</TableCell>
              <TableCell>SKU</TableCell>
              <TableCell align="right">Units Assigned</TableCell>
              <TableCell align="right">Current Stock</TableCell>
              <TableCell>Created</TableCell>
              <TableCell align="center">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filteredBarcodes.map((barcode) => (
              <TableRow key={barcode.id}>
                <TableCell>
                  <Typography
                    variant="body2"
                    fontFamily="monospace"
                    fontWeight="bold"
                  >
                    {barcode.barcode}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="subtitle2">
                    {barcode.product_name}
                  </Typography>
                </TableCell>
                <TableCell>{barcode.product_sku}</TableCell>
                <TableCell align="right">{barcode.units_assigned}</TableCell>
                <TableCell align="right">
                  <Typography
                    variant="body2"
                    color={
                      barcode.product_stock <= 0 ? 'error' : 'text.primary'
                    }
                    fontWeight="bold"
                  >
                    {barcode.product_stock}
                  </Typography>
                </TableCell>
                <TableCell>
                  {format(new Date(barcode.created_at), 'MMM dd, yyyy HH:mm')}
                </TableCell>
                <TableCell align="center">
                  <Box
                    sx={{
                      display: 'flex',
                      gap: 0.5,
                      justifyContent: 'center',
                    }}
                  >
                    <IconButton
                      size="small"
                      onClick={() => handlePreviewBarcode(barcode)}
                      title="Preview Barcode"
                      color="info"
                    >
                      <QrCode />
                    </IconButton>
                    <IconButton
                      size="small"
                      onClick={() => handlePrintBarcodes(barcode)}
                      title="Print Barcode"
                      color="primary"
                    >
                      <PrintOutlined />
                    </IconButton>
                    <IconButton
                      size="small"
                      onClick={() => handleViewDetails(barcode)}
                      title="View Details"
                    >
                      <Visibility />
                    </IconButton>
                    {canDeleteBarcodes && (
                      <IconButton
                        size="small"
                        onClick={() => handleDeleteBarcode(barcode.id)}
                        title="Delete Barcode"
                        color="error"
                      >
                        <Delete />
                      </IconButton>
                    )}
                  </Box>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Pagination Controls */}
      {pagination.pages > 1 && (
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            mt: 3,
            mb: 2,
          }}
        >
          <Typography variant="body2" color="text.secondary">
            Showing {(pagination.page - 1) * pagination.limit + 1} to{' '}
            {Math.min(pagination.page * pagination.limit, pagination.total)} of{' '}
            {pagination.total} barcodes
          </Typography>
          <Pagination
            count={pagination.pages}
            page={pagination.page}
            onChange={(event, newPage) => setPage(newPage)}
            color="primary"
            showFirstButton
            showLastButton
          />
        </Box>
      )}

      {barcodes.length === 0 && (
        <Box sx={{ textAlign: 'center', py: 4 }}>
          <Typography variant="h6" color="text.secondary">
            {search || selectedProduct
              ? 'No barcodes found matching your criteria'
              : 'No barcodes available'}
          </Typography>
          {canEdit && !search && !selectedProduct && (
            <Button
              variant="contained"
              startIcon={<Add />}
              onClick={() => setGenerateDialogOpen(true)}
              sx={{ mt: 2 }}
            >
              Generate Your First Barcodes
            </Button>
          )}
        </Box>
      )}

      {/* Barcode Generation Dialog */}
      <BarcodeGenerationDialog
        open={generateDialogOpen}
        onClose={() => setGenerateDialogOpen(false)}
        onSuccess={() => {
          queryClient.invalidateQueries('barcodes');
        }}
        onPrintGenerated={handlePrintGeneratedBarcodes}
      />

      {/* Barcode Print Dialog */}
      <BarcodePrintDialog
        open={printDialogOpen}
        onClose={() => setPrintDialogOpen(false)}
        barcodes={selectedBarcodesForPrint}
        product={selectedProductForPrint}
        autoPrint={true}
        directPrint={true}
      />

      {/* Barcode Details Dialog */}
      <Dialog
        open={detailDialogOpen}
        onClose={() => setDetailDialogOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>Barcode Details</DialogTitle>
        <DialogContent>
          {selectedBarcode && (
            <Grid container spacing={2} sx={{ mt: 1 }}>
              <Grid item xs={12}>
                <Typography
                  variant="subtitle2"
                  color="text.secondary"
                  gutterBottom
                >
                  Barcode Preview
                </Typography>
                <Box sx={{ display: 'flex', justifyContent: 'center', mb: 2 }}>
                  {(() => {
                    const barcodeImage = generateBarcodeImage(
                      selectedBarcode.barcode,
                    );
                    return barcodeImage ? (
                      <img
                        src={barcodeImage}
                        alt={`Barcode ${selectedBarcode.barcode}`}
                        style={{
                          maxWidth: '300px',
                          height: 'auto',
                          border: '1px solid #e0e0e0',
                          borderRadius: '8px',
                          padding: '12px',
                          backgroundColor: 'white',
                        }}
                      />
                    ) : (
                      <Typography variant="body2" color="text.secondary">
                        Preview unavailable
                      </Typography>
                    );
                  })()}
                </Box>
              </Grid>
              <Grid item xs={12} sm={6}>
                <Typography variant="subtitle2" color="text.secondary">
                  Barcode Number
                </Typography>
                <Typography variant="h6" fontFamily="monospace">
                  {selectedBarcode.barcode}
                </Typography>
              </Grid>
              <Grid item xs={12} sm={6}>
                <Typography variant="subtitle2" color="text.secondary">
                  Product
                </Typography>
                <Typography variant="body1">
                  {selectedBarcode.product_name} ({selectedBarcode.product_sku})
                </Typography>
              </Grid>
              <Grid item xs={12} sm={6}>
                <Typography variant="subtitle2" color="text.secondary">
                  Units Assigned
                </Typography>
                <Typography variant="body1">
                  {selectedBarcode.units_assigned}
                </Typography>
              </Grid>
              <Grid item xs={12} sm={6}>
                <Typography variant="subtitle2" color="text.secondary">
                  Current Stock
                </Typography>
                <Typography
                  variant="body1"
                  color={
                    selectedBarcode.product_stock <= 0
                      ? 'error'
                      : 'text.primary'
                  }
                  fontWeight="bold"
                >
                  {selectedBarcode.product_stock}
                </Typography>
              </Grid>
              <Grid item xs={12} sm={6}>
                <Typography variant="subtitle2" color="text.secondary">
                  Created Date
                </Typography>
                <Typography variant="body1">
                  {format(
                    new Date(selectedBarcode.created_at),
                    'MMM dd, yyyy HH:mm',
                  )}
                </Typography>
              </Grid>
              <Grid item xs={12} sm={6}>
                <Typography variant="subtitle2" color="text.secondary">
                  Last Updated
                </Typography>
                <Typography variant="body1">
                  {selectedBarcode.last_updated
                    ? format(
                        new Date(selectedBarcode.last_updated),
                        'MMM dd, yyyy HH:mm',
                      )
                    : 'Never'}
                </Typography>
              </Grid>
            </Grid>
          )}
        </DialogContent>
        <DialogActions>
          <Button
            variant="outlined"
            startIcon={<Print />}
            onClick={() => {
              setDetailDialogOpen(false);
              handlePrintBarcodes(selectedBarcode);
            }}
          >
            Print Barcode
          </Button>
          <Button onClick={() => setDetailDialogOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* Barcode Preview Dialog */}
      <Dialog
        open={previewDialogOpen}
        onClose={() => setPreviewDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Barcode Preview</DialogTitle>
        <DialogContent>
          {selectedBarcodeForPreview && (
            <Box sx={{ textAlign: 'center', py: 2 }}>
              {/* Product Details */}
              <Box sx={{ mb: 3 }}>
                <Typography variant="h5" gutterBottom fontWeight="bold">
                  {selectedBarcodeForPreview.product_name}
                </Typography>
                <Typography variant="h6" color="primary" gutterBottom>
                  SKU: {selectedBarcodeForPreview.product_sku}
                </Typography>
              </Box>

              {/* Barcode Image */}
              <Box sx={{ display: 'flex', justifyContent: 'center' }}>
                {(() => {
                  const barcodeImage = generateBarcodeImage(
                    selectedBarcodeForPreview.barcode,
                  );
                  return barcodeImage ? (
                    <img
                      src={barcodeImage}
                      alt={`Barcode ${selectedBarcodeForPreview.barcode}`}
                      style={{
                        maxWidth: '400px',
                        height: 'auto',
                        border: '1px solid #e0e0e0',
                        borderRadius: '8px',
                        padding: '16px',
                        backgroundColor: 'white',
                      }}
                    />
                  ) : (
                    <Typography variant="body2" color="text.secondary">
                      Preview unavailable
                    </Typography>
                  );
                })()}
              </Box>

              {/* Additional Info */}
              <Box sx={{ mt: 2 }}>
                <Typography variant="body2" color="text.secondary">
                  Units Assigned: {selectedBarcodeForPreview.units_assigned} |
                  Current Stock: {selectedBarcodeForPreview.product_stock}
                </Typography>
              </Box>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPreviewDialogOpen(false)}>Close</Button>
          <Button
            variant="contained"
            startIcon={<PrintOutlined />}
            onClick={() => {
              if (selectedBarcodeForPreview) {
                handlePrintBarcodes(selectedBarcodeForPreview);
                setPreviewDialogOpen(false);
              }
            }}
          >
            Print Barcode
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default Barcodes;
