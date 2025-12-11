import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Box,
  Typography,
  TextField,
  Button,
  Card,
  CardContent,
  Grid,
  Alert,
  List,
  ListItem,
  ListItemText,
  Divider,
  Avatar,
  Chip,
} from '@mui/material';
import {
  QrCodeScanner,
  Add,
  Remove,
  History,
  Inventory,
  Search,
} from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import axios from 'axios';
import toast from 'react-hot-toast';
import LoadingSpinner from '../components/Common/LoadingSpinner';
import { useAuth } from '../contexts/AuthContext';

const BarcodeScanner = () => {
  const [barcodeInput, setBarcodeInput] = useState('');
  const [scannedProduct, setScannedProduct] = useState(null);
  const [selectedTransactionType, setSelectedTransactionType] = useState('IN');
  const [isScanning, setIsScanning] = useState(false);
  const [lastScannedBarcode, setLastScannedBarcode] = useState('');
  const [isBulkMode, setIsBulkMode] = useState(false);
  const [bulkResults, setBulkResults] = useState(null);
  const [isProcessingBulk, setIsProcessingBulk] = useState(false);
  const [transactionDate, setTransactionDate] = useState(
    new Date().toISOString().split('T')[0],
  ); // Default to today's date
  const inputRef = useRef(null);
  const queryClient = useQueryClient();
  const { user } = useAuth();

  // Robust focus function with multiple attempts
  const focusInput = useCallback(() => {
    if (inputRef.current) {
      // Try immediate focus
      inputRef.current.focus();

      // Try again after a short delay to ensure it works
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          // Ensure the input is visible and focused
          inputRef.current.select();
        }
      }, 100);

      // Final attempt with longer delay for cases where input might be disabled
      setTimeout(() => {
        if (inputRef.current && !inputRef.current.disabled) {
          inputRef.current.focus();
          inputRef.current.select();
        }
      }, 300);
    }
  }, []);

  // Handle barcode input change
  const handleBarcodeInputChange = (e) => {
    const value = e.target.value;
    setBarcodeInput(value);

    // Auto-detect bulk mode if multiple barcodes detected (space or newline separated)
    const barcodes = value.split(/\s+/).filter((b) => b.trim().length > 0);
    if (barcodes.length > 1 && !isBulkMode) {
      setIsBulkMode(true);
    }
  };

  // Handle input click to ensure focus
  const handleInputClick = () => {
    focusInput();
  };

  // Handle key press events (for USB scanner Enter detection)
  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleBarcodeSubmit(e);
    }
  };

  // Check if barcode has already been stocked in (prevent duplicates)
  const checkBarcodeAlreadyStockedIn = async (barcode) => {
    try {
      const response = await axios.get(
        `/api/scanner/check-stock-in/${barcode}`,
      );
      return response.data.alreadyStockedIn;
    } catch (error) {
      console.error('Error checking barcode stock status:', error);
      return false; // Allow stock in if check fails
    }
  };

  // Auto stock in handler - for automatic processing
  const handleAutoStockIn = (productData) => {
    if (!productData?.barcode) return;

    const barcode = productData.barcode;

    stockUpdateMutation.mutate({
      barcode: barcode,
      type: 'in',
      quantity: 1,
      notes: 'Auto stock in via USB scanner',
    });
  };

  // Auto stock out handler - for automatic processing
  const handleAutoStockOut = (productData) => {
    if (!productData?.barcode) return;

    const barcode = productData.barcode;

    stockUpdateMutation.mutate({
      barcode: barcode,
      type: 'out',
      quantity: 1,
      notes: 'Auto stock out via USB scanner',
    });
  };

  // Handle barcode submit - AUTO PROCESSING
  const handleBarcodeSubmit = async (e) => {
    e.preventDefault();
    if (!barcodeInput.trim()) return;

    const input = barcodeInput.trim();

    // Check if input contains multiple barcodes (space-separated)
    // Split by whitespace (spaces, tabs, newlines) and filter out empty strings
    const barcodes = input
      .split(/\s+/)
      .map((b) => b.trim())
      .filter((b) => b.length > 0);

    if (barcodes.length > 1 || isBulkMode) {
      // Bulk processing mode
      handleBulkSubmit(barcodes);
      return;
    }

    // Single barcode processing
    const barcode = barcodes[0];

    // Prevent duplicate scanning of the same barcode
    if (barcode === lastScannedBarcode) {
      toast.error(
        '❌ This barcode was just scanned. Please scan a different barcode.',
      );
      setBarcodeInput('');
      setIsScanning(false);
      focusInput();
      return;
    }

    // For stock IN operations, check if barcode is already stocked in
    if (selectedTransactionType === 'IN') {
      try {
        const alreadyStockedIn = await checkBarcodeAlreadyStockedIn(barcode);
        if (alreadyStockedIn) {
          toast.warning('⚠️ Barcode already stocked in. Ignored.');
          setBarcodeInput('');
          setIsScanning(false);
          focusInput();
          return;
        }
      } catch (error) {
        console.error('Error checking barcode status:', error);
        // Continue with lookup if check fails
      }
    }

    setIsScanning(true);
    lookupMutation.mutate(barcode);
  };

  // Handle bulk barcode submit
  const handleBulkSubmit = async (barcodes) => {
    if (barcodes.length === 0) return;

    // Clean and trim all barcodes
    const cleanedBarcodes = barcodes
      .map((b) => b.trim())
      .filter((b) => b.length > 0);

    if (cleanedBarcodes.length === 0) {
      toast.error('❌ No valid barcodes found');
      return;
    }

    if (cleanedBarcodes.length > 100) {
      toast.error('❌ Maximum 100 barcodes allowed per bulk operation');
      return;
    }

    setIsProcessingBulk(true);
    setBulkResults(null);

    try {
      // Use selected date or current date if not set
      const dateToUse =
        transactionDate || new Date().toISOString().split('T')[0];

      const response = await axios.post('/api/scanner/bulk-update-stock', {
        barcodes: cleanedBarcodes,
        type: selectedTransactionType.toLowerCase(),
        quantity: 1,
        notes: `Bulk ${selectedTransactionType} via scanner`,
        transaction_date: dateToUse,
      });

      const results = response.data.data;
      setBulkResults(results);

      // Show summary toast
      if (results.summary.successful > 0 && results.summary.failed === 0) {
        toast.success(
          `✅ Successfully processed ${results.summary.successful} barcode(s)`,
        );
      } else if (results.summary.successful > 0) {
        toast.success(
          `✅ Processed ${results.summary.successful} barcode(s), ${results.summary.failed} failed`,
        );
      } else {
        toast.error(`❌ All ${results.summary.failed} barcode(s) failed`);
      }

      // Clear input and refresh data
      setBarcodeInput('');
      queryClient.invalidateQueries('scan-history');
      queryClient.invalidateQueries('scan-stats');
      queryClient.invalidateQueries('products');
      queryClient.invalidateQueries('dashboard');
      queryClient.invalidateQueries('realtime-metrics');

      // Auto-focus for next scan
      setTimeout(() => {
        focusInput();
      }, 200);
    } catch (error) {
      const errorMessage =
        error.response?.data?.message || 'Bulk operation failed';
      toast.error(`❌ ${errorMessage}`);
      setBulkResults(null);
    } finally {
      setIsProcessingBulk(false);
    }
  };

  // Fetch scan history
  const {
    data: scanHistoryData,
    error: scanHistoryError,
    isLoading: scanHistoryLoading,
  } = useQuery('scan-history', () => axios.get('/api/scanner/scan-history'), {
    refetchInterval: 5000, // Refetch every 5 seconds for real-time updates
    enabled: !!user, // Only fetch if user is logged in
    onSuccess: (data) => {
      // console.log("Scan history query success:", data);
    },
    onError: (error) => {
      console.error('Scan history query error:', error);
      if (error.response?.status === 401) {
        console.error('Authentication error - user not logged in');
      }
    },
  });

  // Fetch scan statistics
  const {
    data: scanStatsData,
    error: scanStatsError,
    isLoading: scanStatsLoading,
  } = useQuery('scan-stats', () => axios.get('/api/scanner/stats'), {
    refetchInterval: 10000, // Refetch every 10 seconds for real-time updates
    enabled: !!user, // Only fetch if user is logged in
    onSuccess: (data) => {
      // console.log("Scan stats query success:", data);
    },
    onError: (error) => {
      console.error('Scan stats query error:', error);
      if (error.response?.status === 401) {
        console.error('Authentication error - user not logged in');
      }
    },
  });

  // Lookup barcode mutation
  const lookupMutation = useMutation(
    (barcode) => axios.post('/api/scanner/lookup', { barcode }),
    {
      onSuccess: (response) => {
        setScannedProduct(response.data.data);
        setIsScanning(false);
        // Auto-perform stock operation based on selected mode
        if (selectedTransactionType === 'IN') {
          handleAutoStockIn(response.data.data);
        } else {
          handleAutoStockOut(response.data.data);
        }
      },
      onError: (error) => {
        const errorMessage =
          error.response?.data?.message || 'Barcode not recognized';
        if (
          errorMessage.includes('Invalid barcode format') ||
          errorMessage.includes('not found in our system')
        ) {
          toast.error(
            '❌ Invalid barcode - Only system-generated barcodes are accepted',
          );
        } else if (
          errorMessage.includes('Duplicate') &&
          errorMessage.includes('operation detected')
        ) {
          toast.error(
            '⚠️ Duplicate operation - Same transaction type already performed recently. Please wait before repeating the same operation.',
          );
        } else if (
          errorMessage.includes(
            'Cannot perform stock OUT on barcode that was never stocked IN',
          )
        ) {
          toast.error(
            '❌ Invalid stock OUT - This barcode was never stocked IN. Please stock IN first.',
          );
        } else {
          toast.error('❌ Barcode not recognized');
        }
        // Clear UI state on error
        setScannedProduct(null);
        setIsScanning(false);
        setBarcodeInput('');
        setLastScannedBarcode('');
        // Auto-focus for next scan
        setTimeout(() => {
          focusInput();
        }, 200);
      },
    },
  );

  // Direct stock update mutation - NO DIALOGS, NO CONFIRMATIONS
  const stockUpdateMutation = useMutation(
    (data) => axios.post('/api/scanner/update-stock', data),
    {
      onSuccess: (response, variables) => {
        const type =
          variables.type === 'in'
            ? '✅ Stock In Recorded'
            : '✅ Stock Out Recorded';
        toast.success(type);

        // Track the last scanned barcode to prevent duplicates
        setLastScannedBarcode(variables.barcode);

        // Clear input field for next scan
        setBarcodeInput('');
        setScannedProduct(null);
        setIsScanning(false);

        // Refresh data immediately after successful scan
        queryClient.invalidateQueries('scan-history');
        queryClient.invalidateQueries('scan-stats');
        queryClient.invalidateQueries('products');
        queryClient.invalidateQueries('dashboard');
        queryClient.invalidateQueries('realtime-metrics');

        // Force refetch the stats to ensure immediate update
        queryClient.refetchQueries('scan-stats');
        queryClient.refetchQueries('scan-history');
        queryClient.refetchQueries('dashboard');

        // Auto-focus for next scan
        setTimeout(() => {
          focusInput();
        }, 200);

        // Clear the last scanned barcode after 5 seconds to allow re-scanning
        setTimeout(() => {
          setLastScannedBarcode('');
        }, 5000);
      },
      onError: (error) => {
        const errorMessage =
          error.response?.data?.message || 'Stock update failed';
        if (
          errorMessage.includes('Invalid barcode format') ||
          errorMessage.includes('not found in our system')
        ) {
          toast.error(
            '❌ Invalid barcode - Only system-generated barcodes are accepted',
          );
        } else if (
          errorMessage.includes('Duplicate') &&
          errorMessage.includes('operation detected')
        ) {
          toast.error(
            '⚠️ Duplicate operation - Same transaction type already performed recently. Please wait before repeating the same operation.',
          );
        } else if (
          errorMessage.includes(
            'Cannot perform stock OUT on barcode that was never stocked IN',
          )
        ) {
          toast.error(
            '❌ Invalid stock OUT - This barcode was never stocked IN. Please stock IN first.',
          );
        } else {
          toast.error(errorMessage);
        }
        // Clear UI state on error
        setScannedProduct(null);
        setIsScanning(false);
        setBarcodeInput('');
        setLastScannedBarcode('');
        // Auto-focus for next scan
        setTimeout(() => {
          focusInput();
        }, 200);
      },
    },
  );

  // Global click handler to refocus input
  useEffect(() => {
    const handleGlobalClick = (e) => {
      // Only refocus if not clicking on interactive elements
      if (
        !e.target.closest('button') &&
        !e.target.closest('input') &&
        !e.target.closest('a') &&
        !e.target.closest("[role='button']") &&
        !e.target.closest('.MuiDialog-root') &&
        !isScanning &&
        !lookupMutation.isLoading &&
        !stockUpdateMutation.isLoading
      ) {
        focusInput();
      }
    };

    document.addEventListener('click', handleGlobalClick);
    return () => document.removeEventListener('click', handleGlobalClick);
  }, [
    isScanning,
    lookupMutation.isLoading,
    stockUpdateMutation.isLoading,
    focusInput,
  ]);

  // Auto-focus on component mount
  useEffect(() => {
    focusInput();
  }, [focusInput]);

  // Auto-focus when page becomes visible
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        focusInput();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () =>
      document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [focusInput]);

  const scanHistory = Array.isArray(scanHistoryData?.data?.data)
    ? scanHistoryData.data.data
    : [];
  const scanStats = scanStatsData?.data?.data?.summary || {};

  // Show authentication message if user is not logged in
  if (!user) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="warning" sx={{ mb: 2 }}>
          Please log in to view scanning statistics and use the barcode scanner.
        </Alert>
        <Button
          variant="contained"
          onClick={() => (window.location.href = '/login')}
          sx={{ mt: 2 }}
        >
          Go to Login
        </Button>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h4" gutterBottom>
        Barcode Scanner
      </Typography>

      {/* Scanner Mode Banner */}
      <Card
        sx={{
          mb: 3,
          background: 'linear-gradient(135deg, #1976d2 0%, #1565c0 100%)',
          color: 'white',
          boxShadow: 3,
        }}
      >
        <CardContent sx={{ py: 3 }}>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
              <QrCodeScanner sx={{ fontSize: 32, mr: 2 }} />
              <Box>
                <Typography variant="h5" sx={{ fontWeight: 'bold', mb: 0.5 }}>
                  Scanner Mode: Stock {selectedTransactionType}
                </Typography>
                <Typography variant="body2" sx={{ opacity: 0.9 }}>
                  Ready to receive inventory - USB/Bluetooth scanner supported
                </Typography>
              </Box>
            </Box>
            <Box sx={{ display: 'flex', gap: 2 }}>
              <Button
                variant={
                  selectedTransactionType === 'IN' ? 'contained' : 'outlined'
                }
                size="large"
                startIcon={<Add />}
                endIcon={<Inventory />}
                onClick={() => setSelectedTransactionType('IN')}
                sx={{
                  minWidth: 140,
                  height: 48,
                  backgroundColor:
                    selectedTransactionType === 'IN' ? 'white' : 'transparent',
                  color: selectedTransactionType === 'IN' ? '#1976d2' : 'white',
                  borderColor: 'white',
                  '&:hover': {
                    backgroundColor:
                      selectedTransactionType === 'IN'
                        ? 'rgba(255,255,255,0.9)'
                        : 'rgba(255,255,255,0.1)',
                    borderColor: 'white',
                  },
                }}
              >
                STOCK IN
              </Button>
              <Button
                variant={
                  selectedTransactionType === 'OUT' ? 'contained' : 'outlined'
                }
                size="large"
                startIcon={<Remove />}
                endIcon={<Inventory />}
                onClick={() => setSelectedTransactionType('OUT')}
                sx={{
                  minWidth: 140,
                  height: 48,
                  backgroundColor:
                    selectedTransactionType === 'OUT' ? 'white' : 'transparent',
                  color:
                    selectedTransactionType === 'OUT' ? '#1976d2' : 'white',
                  borderColor: 'white',
                  '&:hover': {
                    backgroundColor:
                      selectedTransactionType === 'OUT'
                        ? 'rgba(255,255,255,0.9)'
                        : 'rgba(255,255,255,0.1)',
                    borderColor: 'white',
                  },
                }}
              >
                STOCK OUT
              </Button>
            </Box>
          </Box>
        </CardContent>
      </Card>

      <Grid container spacing={3}>
        {/* Scanner Section */}
        <Grid item xs={12} md={8}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
                <QrCodeScanner sx={{ mr: 1, color: 'primary.main' }} />
                <Typography variant="h5">Scan or Enter Barcode</Typography>
              </Box>

              <form onSubmit={handleBarcodeSubmit}>
                <Box
                  sx={{
                    display: 'flex',
                    gap: 2,
                    mb: 2,
                    alignItems: isBulkMode ? 'stretch' : 'flex-start',
                  }}
                >
                  <Box sx={{ flex: 1 }}>
                    <TextField
                      inputRef={inputRef}
                      fullWidth
                      label="Barcode Scanner / Manual Entry"
                      value={barcodeInput}
                      onChange={handleBarcodeInputChange}
                      onKeyPress={handleKeyPress}
                      placeholder={
                        isBulkMode
                          ? 'Enter multiple barcodes separated by spaces...'
                          : 'Scan barcode with USB scanner OR type manually...'
                      }
                      disabled={
                        isScanning ||
                        lookupMutation.isLoading ||
                        isProcessingBulk
                      }
                      size="medium"
                      InputProps={{
                        startAdornment: (
                          <QrCodeScanner
                            sx={{ color: 'action.active', mr: 1 }}
                          />
                        ),
                        onClick: handleInputClick,
                      }}
                      helperText={
                        isBulkMode
                          ? 'Enter multiple barcodes separated by spaces'
                          : 'Use USB scanner or type barcode number manually'
                      }
                    />
                  </Box>
                  <Box
                    sx={{
                      display: 'flex',
                      alignItems: isBulkMode ? 'center' : 'flex-end',
                      pb: isBulkMode ? 0 : 0,
                      height: isBulkMode ? '100%' : '56.5px',
                      alignSelf: isBulkMode ? 'stretch' : 'auto',
                    }}
                  >
                    <Button
                      type="submit"
                      variant="contained"
                      disabled={
                        !barcodeInput.trim() ||
                        isScanning ||
                        lookupMutation.isLoading ||
                        isProcessingBulk
                      }
                      size="large"
                      sx={{
                        minWidth: 120,
                        height: '56.5px',
                        minHeight: '56.5px',
                        maxHeight: '56.5px',
                      }}
                      startIcon={<Search />}
                    >
                      {isScanning ||
                      lookupMutation.isLoading ||
                      isProcessingBulk ? (
                        <LoadingSpinner size={20} />
                      ) : (
                        'PROCESS'
                      )}
                    </Button>
                  </Box>
                </Box>
                <Box
                  sx={{
                    mb: 3,
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 2,
                    flexWrap: 'wrap',
                  }}
                >
                  <Button
                    variant={isBulkMode ? 'contained' : 'outlined'}
                    size="small"
                    onClick={() => {
                      setIsBulkMode(!isBulkMode);
                      setBulkResults(null);
                      setBarcodeInput('');
                      // Reset date to today when toggling modes
                      setTransactionDate(
                        new Date().toISOString().split('T')[0],
                      );
                    }}
                    sx={{ minWidth: 120, height: '40px' }}
                  >
                    {isBulkMode ? 'Single Mode' : 'Bulk Mode'}
                  </Button>
                  {isBulkMode && (
                    <>
                      <TextField
                        label="Transaction Date"
                        type="date"
                        value={transactionDate}
                        onChange={(e) => setTransactionDate(e.target.value)}
                        size="small"
                        InputLabelProps={{ shrink: true }}
                        sx={{
                          minWidth: 180,
                          '& .MuiInputBase-root': {
                            height: '40px',
                          },
                          '& .MuiFormHelperText-root': {
                            marginTop: 0.5,
                            marginBottom: 0,
                          },
                        }}
                        helperText="Select date for transaction (defaults to today)"
                      />
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{ flex: 1, alignSelf: 'center' }}
                      >
                        Paste multiple barcodes separated by spaces
                      </Typography>
                    </>
                  )}
                </Box>
              </form>

              {/* Instructions */}
              <Alert severity="info" sx={{ mb: 3 }}>
                <Typography variant="body2">
                  <strong>Scanner Instructions:</strong>
                  <br />
                  • Select Stock IN or Stock OUT mode above
                  <br />• <strong>Single Mode:</strong> Scan barcode with USB
                  scanner (auto-processes on Enter) or type manually
                  <br /> • <strong>Bulk Mode:</strong> Toggle "Bulk Mode" button
                  to enable bulk processing. Paste multiple barcodes separated
                  by spaces. Use the date picker to select transaction date
                  (defaults to today if not selected)
                  <br />•{' '}
                  <strong>Only system-generated barcodes are accepted</strong>
                  <br />
                  • System will automatically process the transaction(s)
                  <br />
                  • Duplicate operations are prevented (5-minute cooldown per
                  transaction type)
                  <br />
                  • Duplicate stock-in entries are prevented
                  <br />• Input field auto-focuses for continuous scanning
                  <br />• Bulk operations support up to 100 barcodes at once
                </Typography>
              </Alert>

              {/* Loading State */}
              {(isScanning ||
                lookupMutation.isLoading ||
                stockUpdateMutation.isLoading ||
                isProcessingBulk) && (
                <Box
                  sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}
                >
                  <LoadingSpinner size={20} />
                  <Typography variant="body2">
                    {isProcessingBulk
                      ? 'Processing bulk operation...'
                      : isScanning || lookupMutation.isLoading
                      ? 'Looking up barcode...'
                      : 'Processing transaction...'}
                  </Typography>
                </Box>
              )}

              {/* Bulk Results */}
              {bulkResults && (
                <Card
                  sx={{
                    mt: 2,
                    border: '1px solid',
                    borderColor:
                      bulkResults.summary.failed === 0
                        ? 'success.main'
                        : bulkResults.summary.successful === 0
                        ? 'error.main'
                        : 'warning.main',
                  }}
                >
                  <CardContent>
                    <Typography variant="h6" gutterBottom>
                      Bulk Operation Results
                    </Typography>
                    <Box sx={{ mb: 2 }}>
                      <Typography variant="body2" color="text.secondary">
                        Total: {bulkResults.summary.total} | Successful:{' '}
                        <span style={{ color: '#2e7d32' }}>
                          {bulkResults.summary.successful}
                        </span>{' '}
                        | Failed:{' '}
                        <span style={{ color: '#d32f2f' }}>
                          {bulkResults.summary.failed}
                        </span>
                      </Typography>
                    </Box>
                    {bulkResults.failed.length > 0 && (
                      <Box sx={{ mb: 2 }}>
                        <Typography
                          variant="subtitle2"
                          color="error"
                          gutterBottom
                        >
                          Failed Barcodes ({bulkResults.failed.length}):
                        </Typography>
                        <List dense>
                          {bulkResults.failed.slice(0, 10).map((item, idx) => (
                            <ListItem key={idx} sx={{ px: 0, py: 0.5 }}>
                              <ListItemText
                                primary={
                                  <Typography variant="body2">
                                    {item.barcode}
                                  </Typography>
                                }
                                secondary={
                                  <Typography variant="caption" color="error">
                                    {item.error}
                                  </Typography>
                                }
                              />
                            </ListItem>
                          ))}
                          {bulkResults.failed.length > 10 && (
                            <Typography
                              variant="caption"
                              color="text.secondary"
                            >
                              ... and {bulkResults.failed.length - 10} more
                            </Typography>
                          )}
                        </List>
                      </Box>
                    )}
                    {bulkResults.successful.length > 0 && (
                      <Box>
                        <Typography
                          variant="subtitle2"
                          color="success.main"
                          gutterBottom
                        >
                          Successful Barcodes ({bulkResults.successful.length}):
                        </Typography>
                        <List dense>
                          {bulkResults.successful
                            .slice(0, 10)
                            .map((item, idx) => (
                              <ListItem key={idx} sx={{ px: 0, py: 0.5 }}>
                                <ListItemText
                                  primary={
                                    <Typography variant="body2">
                                      {item.barcode} - {item.product.name}
                                    </Typography>
                                  }
                                  secondary={
                                    <Typography
                                      variant="caption"
                                      color="text.secondary"
                                    >
                                      Stock{' '}
                                      {item.transaction.type.toUpperCase()} |{' '}
                                      {item.transaction.previousStock} →{' '}
                                      {item.transaction.newStock}
                                    </Typography>
                                  }
                                />
                              </ListItem>
                            ))}
                          {bulkResults.successful.length > 10 && (
                            <Typography
                              variant="caption"
                              color="text.secondary"
                            >
                              ... and {bulkResults.successful.length - 10} more
                            </Typography>
                          )}
                        </List>
                      </Box>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Scanned Product Display */}
              {scannedProduct && (
                <Card
                  sx={{
                    mt: 2,
                    border: '1px solid',
                    borderColor: 'primary.main',
                  }}
                >
                  <CardContent>
                    <Typography variant="h6" gutterBottom>
                      Scanned Product
                    </Typography>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                      <Avatar
                        src={scannedProduct.product?.image_url}
                        sx={{ width: 60, height: 60 }}
                      >
                        <Inventory />
                      </Avatar>
                      <Box sx={{ flex: 1 }}>
                        <Typography variant="h6">
                          {scannedProduct.product?.name || 'Unknown Product'}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          SKU: {scannedProduct.product?.sku || 'N/A'}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          Barcode: {scannedProduct.barcode?.barcode || 'N/A'}
                        </Typography>
                      </Box>
                      <Chip
                        label={`${
                          selectedTransactionType === 'IN'
                            ? 'Stock IN'
                            : 'Stock OUT'
                        } Ready`}
                        color={
                          selectedTransactionType === 'IN' ? 'success' : 'error'
                        }
                        variant="filled"
                      />
                    </Box>
                  </CardContent>
                </Card>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Statistics Section */}
        <Grid item xs={12} md={4}>
          <Card sx={{ mb: 3 }}>
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
                  <Inventory sx={{ mr: 1, verticalAlign: 'middle' }} />
                  Scanning Stats (Last 7 Days)
                </Typography>
                <Button
                  size="small"
                  onClick={() => {
                    queryClient.invalidateQueries('scan-stats');
                    queryClient.invalidateQueries('scan-history');
                  }}
                  disabled={scanStatsLoading || scanHistoryLoading}
                >
                  Refresh
                </Button>
              </Box>
              {scanStatsLoading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
                  <LoadingSpinner size={24} />
                </Box>
              ) : scanStatsError ? (
                <Alert severity="error" sx={{ mb: 2 }}>
                  Error loading stats:{' '}
                  {scanStatsError.response?.status === 401
                    ? 'Please log in to view statistics'
                    : scanStatsError.message}
                </Alert>
              ) : (
                <Grid container spacing={2}>
                  <Grid item xs={6}>
                    <Typography variant="body2" color="text.secondary">
                      Total Scans
                    </Typography>
                    <Typography variant="h4" color="primary.main">
                      {scanStats.total_scans || 0}
                    </Typography>
                  </Grid>
                  <Grid item xs={6}>
                    <Typography variant="body2" color="text.secondary">
                      Stock IN
                    </Typography>
                    <Typography variant="h4" color="success.main">
                      {scanStats.stock_in_scans || 0}
                    </Typography>
                  </Grid>
                  <Grid item xs={6}>
                    <Typography variant="body2" color="text.secondary">
                      Stock OUT
                    </Typography>
                    <Typography variant="h4" color="error.main">
                      {scanStats.stock_out_scans || 0}
                    </Typography>
                  </Grid>
                  <Grid item xs={6}>
                    <Typography variant="body2" color="text.secondary">
                      Active Users
                    </Typography>
                    <Typography variant="h4" color="primary.main">
                      {scanStats.active_users || 0}
                    </Typography>
                  </Grid>
                </Grid>
              )}
            </CardContent>
          </Card>

          {/* Recent Scan History */}
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                <History sx={{ mr: 1, verticalAlign: 'middle' }} />
                Recent Scans
              </Typography>
              {scanHistoryLoading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
                  <LoadingSpinner size={24} />
                </Box>
              ) : scanHistoryError ? (
                <Alert severity="error" sx={{ mb: 2 }}>
                  Error loading scan history:{' '}
                  {scanHistoryError.response?.status === 401
                    ? 'Please log in to view scan history'
                    : scanHistoryError.message}
                </Alert>
              ) : scanHistory.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  No recent scans
                </Typography>
              ) : (
                <List dense>
                  {scanHistory.slice(0, 5).map((scan, index) => (
                    <React.Fragment key={scan.id || index}>
                      <ListItem sx={{ px: 0 }}>
                        <Avatar
                          sx={{
                            bgcolor:
                              scan.type === 'in'
                                ? 'success.main'
                                : 'error.main',
                            mr: 2,
                            width: 32,
                            height: 32,
                          }}
                        >
                          {scan.type === 'in' ? (
                            <Add fontSize="small" />
                          ) : (
                            <Remove fontSize="small" />
                          )}
                        </Avatar>
                        <ListItemText
                          primary={
                            <Typography variant="body2">
                              {scan.product_name || 'Unknown Product'}
                            </Typography>
                          }
                          secondary={
                            <Typography
                              variant="caption"
                              color="text.secondary"
                            >
                              {scan.type === 'in' ? 'Stock IN' : 'Stock OUT'} •{' '}
                              {scan.quantity} units •{' '}
                              {new Date(scan.created_at).toLocaleTimeString()}
                            </Typography>
                          }
                        />
                      </ListItem>
                      {index < Math.min(scanHistory.length, 5) - 1 && (
                        <Divider />
                      )}
                    </React.Fragment>
                  ))}
                </List>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
};

export default BarcodeScanner;
