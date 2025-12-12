import React, { useState, useRef, useEffect } from 'react';
import {
  Box,
  Typography,
  TextField,
  Button,
  Card,
  CardContent,
  Grid,
  Alert,
  Autocomplete,
  Chip,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Divider,
} from '@mui/material';
import {
  CompareArrows,
  CheckCircle,
  Error,
  Warning,
  QrCodeScanner,
  Search,
  Download,
} from '@mui/icons-material';
import { useQuery, useMutation } from 'react-query';
import axios from 'axios';
import toast from 'react-hot-toast';
import LoadingSpinner from '../components/Common/LoadingSpinner';
import { useAuth } from '../contexts/AuthContext';

const Reconciliation = () => {
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [barcodeInput, setBarcodeInput] = useState('');
  const [reconciliationResult, setReconciliationResult] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const inputRef = useRef(null);
  const { user } = useAuth();

  // Fetch products for selection
  const {
    data: productsData,
    isLoading: productsLoading,
    error: productsError,
    refetch: refetchProducts,
  } = useQuery(
    'reconciliation-products',
    () => axios.get('/api/reconciliation/products').then((res) => res.data),
    {
      enabled: !!user,
      staleTime: 30000, // Cache for 30 seconds
    }
  );

  const products = productsData?.data || [];
  
  // Log for debugging
  useEffect(() => {
    if (productsData) {
      console.log('[RECONCILIATION] Products loaded:', products.length);
    }
    if (productsError) {
      console.error('[RECONCILIATION] Error loading products:', productsError);
    }
  }, [productsData, productsError, products.length]);

  // Handle barcode input change
  const handleBarcodeInputChange = (e) => {
    setBarcodeInput(e.target.value);
  };

  // Handle reconciliation
  const handleReconcile = async () => {
    if (!selectedProduct) {
      toast.error('Please select a product');
      return;
    }

    if (!barcodeInput.trim()) {
      toast.error('Please enter at least one barcode');
      return;
    }

    // Parse barcodes (space or newline separated)
    const barcodes = barcodeInput
      .split(/\s+/)
      .map((b) => b.trim())
      .filter((b) => b.length > 0);

    if (barcodes.length === 0) {
      toast.error('No valid barcodes found');
      return;
    }

    // Check maximum limit
    const MAX_BARCODES = 1000;
    if (barcodes.length > MAX_BARCODES) {
      toast.error(`Maximum ${MAX_BARCODES} barcodes allowed per reconciliation. You have ${barcodes.length} barcodes.`);
      return;
    }

    setIsProcessing(true);
    setReconciliationResult(null);

    try {
      const response = await axios.post('/api/reconciliation', {
        product_id: selectedProduct.id,
        scanned_barcodes: barcodes,
      });

      setReconciliationResult(response.data.data);
      toast.success('Reconciliation completed');
    } catch (error) {
      const errorMessage =
        error.response?.data?.message || 'Reconciliation failed';
      toast.error(`❌ ${errorMessage}`);
      setReconciliationResult(null);
    } finally {
      setIsProcessing(false);
    }
  };

  // Clear all
  const handleClear = () => {
    setSelectedProduct(null);
    setBarcodeInput('');
    setReconciliationResult(null);
  };

  // Download reconciliation results as CSV
  const handleDownloadCSV = () => {
    if (!reconciliationResult || !selectedProduct) {
      toast.error('No reconciliation data to download');
      return;
    }

    try {
      const timestamp = new Date().toISOString().split('T')[0];
      const filename = `reconciliation_${selectedProduct.name}_${timestamp}.csv`;
      
      // Build CSV content
      const csvRows = [];
      
      // Header section
      csvRows.push('Stock Reconciliation Report');
      csvRows.push(`Product: ${reconciliationResult.summary.product.name}`);
      csvRows.push(`SKU: ${reconciliationResult.summary.product.sku}`);
      csvRows.push(`Date: ${new Date().toLocaleString()}`);
      csvRows.push('');
      
      // Summary section
      csvRows.push('SUMMARY');
      csvRows.push(`System Stock (Stocked In),${reconciliationResult.summary.system_stocked_in_count}`);
      csvRows.push(`Scanned Count,${reconciliationResult.summary.scanned_count}`);
      csvRows.push(`Matched,${reconciliationResult.summary.matched_count}`);
      csvRows.push(`Missing (Physically Missing),${reconciliationResult.summary.missing_count}`);
      csvRows.push(`Extra (Not in System),${reconciliationResult.summary.extra_count}`);
      csvRows.push(`Discrepancy,${reconciliationResult.summary.discrepancy}`);
      csvRows.push('');
      
      // Matched barcodes
      if (reconciliationResult.matched.length > 0) {
        csvRows.push('MATCHED BARCODES');
        csvRows.push('Barcode,Units Assigned');
        reconciliationResult.matched.forEach((barcode) => {
          csvRows.push(`${barcode.barcode},${barcode.units_assigned || 0}`);
        });
        csvRows.push('');
      }
      
      // Missing barcodes
      if (reconciliationResult.missing.length > 0) {
        csvRows.push('MISSING BARCODES (Physically Missing)');
        csvRows.push('Barcode,Units Assigned');
        reconciliationResult.missing.forEach((barcode) => {
          csvRows.push(`${barcode.barcode},${barcode.units_assigned || 0}`);
        });
        csvRows.push('');
      }
      
      // Extra barcodes
      if (reconciliationResult.extra.length > 0) {
        csvRows.push('EXTRA BARCODES (Not in System for this Product)');
        csvRows.push('Barcode,Status,Belongs To Product');
        reconciliationResult.extra.forEach((item) => {
          const belongsTo = item.belongs_to_product
            ? `${item.belongs_to_product.name} (${item.belongs_to_product.sku})`
            : 'N/A';
          csvRows.push(`"${item.barcode}","${item.message}","${belongsTo}"`);
        });
        csvRows.push('');
      }
      
      // Create and download CSV
      const csvContent = csvRows.join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      
      toast.success('Reconciliation report downloaded successfully');
    } catch (error) {
      console.error('Download failed:', error);
      toast.error('Failed to download reconciliation report');
    }
  };

  // Auto-focus input
  useEffect(() => {
    if (inputRef.current && selectedProduct) {
      inputRef.current.focus();
    }
  }, [selectedProduct]);

  if (!user) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="warning" sx={{ mb: 2 }}>
          Please log in to use the reconciliation feature.
        </Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h4" gutterBottom>
        Stock Reconciliation
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Compare physical stock with system records by scanning barcodes
      </Typography>

      <Grid container spacing={3}>
        {/* Input Section */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                <CompareArrows sx={{ mr: 1, verticalAlign: 'middle' }} />
                Reconciliation Setup
              </Typography>

              <Box sx={{ mb: 3 }}>
                <Autocomplete
                  options={products}
                  getOptionLabel={(option) =>
                    option ? `${option.name} (${option.sku}) - Stock: ${option.stock_quantity}` : ''
                  }
                  value={selectedProduct}
                  onChange={(event, newValue) => {
                    setSelectedProduct(newValue);
                    setReconciliationResult(null);
                  }}
                  loading={productsLoading}
                  filterOptions={(options, { inputValue }) => {
                    if (!inputValue) return options;
                    const searchLower = inputValue.toLowerCase();
                    return options.filter(
                      (option) =>
                        option.name?.toLowerCase().includes(searchLower) ||
                        option.sku?.toLowerCase().includes(searchLower)
                    );
                  }}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Select Product"
                      placeholder="Search by product name or SKU..."
                      InputProps={{
                        ...params.InputProps,
                        startAdornment: <Search sx={{ mr: 1 }} />,
                      }}
                    />
                  )}
                  renderOption={(props, option) => (
                    <Box component="li" {...props} key={option.id}>
                      <Box sx={{ flex: 1 }}>
                        <Typography variant="body1">{option.name}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          SKU: {option.sku} | Stock: {option.stock_quantity} |
                          Stocked In: {option.stocked_in_barcodes_count || 0}
                        </Typography>
                      </Box>
                    </Box>
                  )}
                  noOptionsText="No products found"
                />
              </Box>

              {selectedProduct && (
                <>
                  <TextField
                    inputRef={inputRef}
                    fullWidth
                    multiline
                    rows={6}
                    label="Scan Barcodes"
                    value={barcodeInput}
                    onChange={handleBarcodeInputChange}
                    placeholder="Enter barcodes separated by spaces or newlines..."
                    helperText={
                      barcodeInput.trim()
                        ? `Barcodes: ${barcodeInput.split(/\s+/).filter((b) => b.trim().length > 0).length} / 1000 (Maximum 1000 barcodes allowed)`
                        : 'Paste multiple barcodes separated by spaces or newlines (Maximum 1000 barcodes)'
                    }
                    sx={{ mb: 2 }}
                  />

                  <Box sx={{ display: 'flex', gap: 2 }}>
                    <Button
                      variant="contained"
                      onClick={handleReconcile}
                      disabled={!barcodeInput.trim() || isProcessing}
                      startIcon={isProcessing ? <LoadingSpinner size={20} /> : <CompareArrows />}
                      sx={{ flex: 1 }}
                    >
                      {isProcessing ? 'Processing...' : 'Reconcile'}
                    </Button>
                    <Button
                      variant="outlined"
                      onClick={handleClear}
                      disabled={isProcessing}
                    >
                      Clear
                    </Button>
                  </Box>
                </>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Results Section */}
        <Grid item xs={12} md={6}>
          {reconciliationResult && (
            <Card>
              <CardContent>
                <Box
                  sx={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    mb: 2,
                  }}
                >
                  <Typography variant="h6">
                    Reconciliation Results
                  </Typography>
                  <Button
                    variant="outlined"
                    color="primary"
                    startIcon={<Download />}
                    onClick={handleDownloadCSV}
                    size="small"
                  >
                    Download CSV
                  </Button>
                </Box>

                {/* Summary */}
                <Box sx={{ mb: 3 }}>
                  <Grid container spacing={2}>
                    <Grid item xs={6}>
                      <Card
                        variant="outlined"
                        sx={{
                          p: 2,
                          textAlign: 'center',
                          bgcolor: 'background.default',
                        }}
                      >
                        <Typography variant="caption" color="text.secondary">
                          System Stock
                        </Typography>
                        <Typography variant="h5">
                          {reconciliationResult.summary.system_stocked_in_count}
                        </Typography>
                      </Card>
                    </Grid>
                    <Grid item xs={6}>
                      <Card
                        variant="outlined"
                        sx={{
                          p: 2,
                          textAlign: 'center',
                          bgcolor: 'background.default',
                        }}
                      >
                        <Typography variant="caption" color="text.secondary">
                          Scanned
                        </Typography>
                        <Typography variant="h5">
                          {reconciliationResult.summary.scanned_count}
                        </Typography>
                      </Card>
                    </Grid>
                    <Grid item xs={4}>
                      <Card
                        variant="outlined"
                        sx={{
                          p: 1.5,
                          textAlign: 'center',
                          bgcolor: 'success.light',
                          color: 'success.contrastText',
                        }}
                      >
                        <Typography variant="caption">Matched</Typography>
                        <Typography variant="h6">
                          {reconciliationResult.summary.matched_count}
                        </Typography>
                      </Card>
                    </Grid>
                    <Grid item xs={4}>
                      <Card
                        variant="outlined"
                        sx={{
                          p: 1.5,
                          textAlign: 'center',
                          bgcolor: 'error.light',
                          color: 'error.contrastText',
                        }}
                      >
                        <Typography variant="caption">Missing</Typography>
                        <Typography variant="h6">
                          {reconciliationResult.summary.missing_count}
                        </Typography>
                      </Card>
                    </Grid>
                    <Grid item xs={4}>
                      <Card
                        variant="outlined"
                        sx={{
                          p: 1.5,
                          textAlign: 'center',
                          bgcolor: 'warning.light',
                          color: 'warning.contrastText',
                        }}
                      >
                        <Typography variant="caption">Extra</Typography>
                        <Typography variant="h6">
                          {reconciliationResult.summary.extra_count}
                        </Typography>
                      </Card>
                    </Grid>
                  </Grid>
                </Box>

                {/* Discrepancy Alert */}
                {reconciliationResult.summary.discrepancy !== 0 && (
                  <Alert
                    severity={
                      reconciliationResult.summary.discrepancy > 0
                        ? 'error'
                        : 'warning'
                    }
                    sx={{ mb: 2 }}
                  >
                    <Typography variant="body2">
                      <strong>Discrepancy:</strong>{' '}
                      {reconciliationResult.summary.discrepancy > 0
                        ? `${Math.abs(reconciliationResult.summary.discrepancy)} items missing physically`
                        : `${Math.abs(reconciliationResult.summary.discrepancy)} extra items scanned`}
                    </Typography>
                  </Alert>
                )}
              </CardContent>
            </Card>
          )}
        </Grid>

        {/* Detailed Results */}
        {reconciliationResult && (
          <Grid item xs={12}>
            <Grid container spacing={2}>
              {/* Missing Barcodes */}
              {reconciliationResult.missing.length > 0 && (
                <Grid item xs={12} md={6}>
                  <Card sx={{ border: '2px solid', borderColor: 'error.main' }}>
                    <CardContent>
                      <Box
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          mb: 2,
                        }}
                      >
                        <Error sx={{ mr: 1, color: 'error.main' }} />
                        <Typography variant="h6" color="error">
                          Missing Barcodes ({reconciliationResult.missing.length})
                        </Typography>
                      </Box>
                      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                        These barcodes are in the system but were not scanned (physically missing)
                      </Typography>
                      <TableContainer component={Paper} variant="outlined">
                        <Table size="small">
                          <TableHead>
                            <TableRow>
                              <TableCell>Barcode</TableCell>
                              <TableCell align="right">Units</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {reconciliationResult.missing.map((barcode) => (
                              <TableRow key={barcode.id}>
                                <TableCell>
                                  <Chip
                                    label={barcode.barcode}
                                    size="small"
                                    color="error"
                                    variant="outlined"
                                  />
                                </TableCell>
                                <TableCell align="right">
                                  {barcode.units_assigned}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </TableContainer>
                    </CardContent>
                  </Card>
                </Grid>
              )}

              {/* Matched Barcodes */}
              {reconciliationResult.matched.length > 0 && (
                <Grid item xs={12} md={6}>
                  <Card sx={{ border: '2px solid', borderColor: 'success.main' }}>
                    <CardContent>
                      <Box
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          mb: 2,
                        }}
                      >
                        <CheckCircle sx={{ mr: 1, color: 'success.main' }} />
                        <Typography variant="h6" color="success.main">
                          Matched Barcodes ({reconciliationResult.matched.length})
                        </Typography>
                      </Box>
                      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                        These barcodes match between system and physical scan
                      </Typography>
                      <TableContainer component={Paper} variant="outlined">
                        <Table size="small">
                          <TableHead>
                            <TableRow>
                              <TableCell>Barcode</TableCell>
                              <TableCell align="right">Units</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {reconciliationResult.matched.slice(0, 20).map((barcode) => (
                              <TableRow key={barcode.id}>
                                <TableCell>
                                  <Chip
                                    label={barcode.barcode}
                                    size="small"
                                    color="success"
                                    variant="outlined"
                                  />
                                </TableCell>
                                <TableCell align="right">
                                  {barcode.units_assigned}
                                </TableCell>
                              </TableRow>
                            ))}
                            {reconciliationResult.matched.length > 20 && (
                              <TableRow>
                                <TableCell colSpan={2} align="center">
                                  <Typography variant="caption" color="text.secondary">
                                    ... and {reconciliationResult.matched.length - 20} more
                                  </Typography>
                                </TableCell>
                              </TableRow>
                            )}
                          </TableBody>
                        </Table>
                      </TableContainer>
                    </CardContent>
                  </Card>
                </Grid>
              )}

              {/* Extra Barcodes */}
              {reconciliationResult.extra.length > 0 && (
                <Grid item xs={12}>
                  <Card sx={{ border: '2px solid', borderColor: 'warning.main' }}>
                    <CardContent>
                      <Box
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          mb: 2,
                        }}
                      >
                        <Warning sx={{ mr: 1, color: 'warning.main' }} />
                        <Typography variant="h6" color="warning.main">
                          Extra Barcodes ({reconciliationResult.extra.length})
                        </Typography>
                      </Box>
                      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                        These barcodes were scanned but don't belong to this product
                      </Typography>
                      <TableContainer component={Paper} variant="outlined">
                        <Table size="small">
                          <TableHead>
                            <TableRow>
                              <TableCell>Barcode</TableCell>
                              <TableCell>Status</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {reconciliationResult.extra.map((item, idx) => (
                              <TableRow key={idx}>
                                <TableCell>
                                  <Chip
                                    label={item.barcode}
                                    size="small"
                                    color="warning"
                                    variant="outlined"
                                  />
                                </TableCell>
                                <TableCell>
                                  <Typography variant="body2">
                                    {item.message}
                                  </Typography>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </TableContainer>
                    </CardContent>
                  </Card>
                </Grid>
              )}
            </Grid>
          </Grid>
        )}
      </Grid>
    </Box>
  );
};

export default Reconciliation;

