import React, { useState, useEffect } from 'react';
import { useQuery } from 'react-query';
import axios from 'axios';
import {
  Box,
  Typography,
  Paper,
  Button,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  TextField,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Chip,
  CircularProgress
} from '@mui/material';
import {
  ExpandMore,
  Download,
  Refresh,
  LocalShipping
} from '@mui/icons-material';

function PickList() {
  const [filters, setFilters] = useState({
    storeName: '',
    courierName: '',
    dateFrom: '',
    dateTo: ''
  });
  const [pickListData, setPickListData] = useState([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);

  // Fetch filter options (stores & couriers)
  const { data: filterOptions } = useQuery(
    'label-filter-options',
    () => axios.get('/api/labels/stats').then(res => res.data),
    { staleTime: 60000 }
  );

  const generatePickList = async () => {
    setIsGenerating(true);
    try {
      const response = await axios.post('/api/picklist/generate', filters);
      setPickListData(response.data);
    } catch (error) {
      console.error('Error generating pick list:', error);
      alert('Failed to generate pick list');
    } finally {
      setIsGenerating(false);
    }
  };

  const downloadPickList = async () => {
    setIsDownloading(true);
    try {
      const response = await axios.post(
        '/api/picklist/download',
        filters,
        { responseType: 'blob' }
      );
      
      // Create download link
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `picklist_${Date.now()}.xlsx`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error downloading pick list:', error);
      alert('Failed to download pick list');
    } finally {
      setIsDownloading(false);
    }
  };

  // Calculate total items across all couriers
  const totalItems = pickListData.reduce((sum, courier) => 
    sum + courier.products.reduce((s, p) => s + p.quantity, 0), 0
  );

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4">Pick List Generator</Typography>
      </Box>

      {/* Filters Section */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" gutterBottom>Filters</Typography>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ mb: 2 }}>
          <FormControl size="small" sx={{ minWidth: 200 }}>
            <InputLabel shrink>Store</InputLabel>
            <Select
              value={filters.storeName}
              label="Store"
              onChange={(e) => setFilters({...filters, storeName: e.target.value})}
              displayEmpty
              notched
              renderValue={(selected) => {
                if (selected === '') {
                  return 'All Stores';
                }
                return selected;
              }}
            >
              <MenuItem value="">All Stores</MenuItem>
              {filterOptions?.data?.stores_breakdown?.map(store => (
                <MenuItem key={store.store_name} value={store.store_name}>
                  {store.store_name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl size="small" sx={{ minWidth: 200 }}>
            <InputLabel shrink>Courier</InputLabel>
            <Select
              value={filters.courierName}
              label="Courier"
              onChange={(e) => setFilters({...filters, courierName: e.target.value})}
              displayEmpty
              notched
              renderValue={(selected) => {
                if (selected === '') {
                  return 'All Couriers';
                }
                return selected;
              }}
            >
              <MenuItem value="">All Couriers</MenuItem>
              {filterOptions?.data?.couriers_breakdown?.map(courier => (
                <MenuItem key={courier.courier_name} value={courier.courier_name}>
                  {courier.courier_name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <TextField 
            label="From Date" 
            type="date"
            size="small"
            InputLabelProps={{ shrink: true }}
            value={filters.dateFrom}
            onChange={(e) => setFilters({...filters, dateFrom: e.target.value})}
            sx={{ width: 180 }}
          />

          <TextField 
            label="To Date" 
            type="date"
            size="small"
            InputLabelProps={{ shrink: true }}
            value={filters.dateTo}
            onChange={(e) => setFilters({...filters, dateTo: e.target.value})}
            sx={{ width: 180 }}
          />
        </Stack>

        <Stack direction="row" spacing={2}>
          <Button 
            variant="contained" 
            color="primary"
            onClick={generatePickList}
            disabled={isGenerating}
            startIcon={isGenerating ? <CircularProgress size={20} color="inherit" /> : <Refresh />}
          >
            {isGenerating ? 'Generating...' : 'Generate Pick List'}
          </Button>

          {pickListData.length > 0 && (
            <Button 
              variant="outlined" 
              color="success"
              onClick={downloadPickList}
              disabled={isDownloading}
              startIcon={isDownloading ? <CircularProgress size={20} color="inherit" /> : <Download />}
            >
              {isDownloading ? 'Downloading...' : 'Download Excel'}
            </Button>
          )}
        </Stack>
      </Paper>

      {/* Summary */}
      {pickListData.length > 0 && (
        <Paper sx={{ p: 2, mb: 3, bgcolor: 'primary.main', color: 'white' }}>
          <Stack direction="row" spacing={4}>
            <Box>
              <Typography variant="subtitle2">Total Couriers</Typography>
              <Typography variant="h4">{pickListData.length}</Typography>
            </Box>
            <Box>
              <Typography variant="subtitle2">Total Items</Typography>
              <Typography variant="h4">{totalItems}</Typography>
            </Box>
          </Stack>
        </Paper>
      )}

      {/* Pick List Display */}
      {pickListData.length > 0 ? (
        <Box>
          {pickListData.map((courierGroup, index) => {
            const courierTotal = courierGroup.products.reduce((sum, p) => sum + p.quantity, 0);
            
            return (
              <Accordion key={index} defaultExpanded>
                <AccordionSummary expandIcon={<ExpandMore />}>
                  <Stack direction="row" spacing={2} alignItems="center" sx={{ width: '100%', pr: 2 }}>
                    <LocalShipping color="primary" />
                    <Typography variant="h6" sx={{ flexGrow: 1 }}>
                      {courierGroup.courier_name}
                    </Typography>
                    <Chip 
                      label={`${courierGroup.products.length} products • ${courierTotal} items`} 
                      color="primary" 
                      variant="outlined"
                    />
                  </Stack>
                </AccordionSummary>
                <AccordionDetails>
                  <TableContainer>
                    <Table size="small">
                      <TableHead>
                        <TableRow sx={{ bgcolor: 'grey.100' }}>
                          <TableCell sx={{ fontWeight: 'bold' }}>Product Name</TableCell>
                          <TableCell align="right" sx={{ fontWeight: 'bold', width: 120 }}>Quantity</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {courierGroup.products.map((product, idx) => (
                          <TableRow key={idx}>
                            <TableCell>{product.product_name}</TableCell>
                            <TableCell align="right">
                              <Chip label={product.quantity} size="small" />
                            </TableCell>
                          </TableRow>
                        ))}
                        <TableRow sx={{ bgcolor: 'warning.light' }}>
                          <TableCell sx={{ fontWeight: 'bold' }}>Total</TableCell>
                          <TableCell align="right">
                            <Chip label={courierTotal} color="warning" />
                          </TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </TableContainer>
                </AccordionDetails>
              </Accordion>
            );
          })}
        </Box>
      ) : (
        <Paper sx={{ p: 4, textAlign: 'center' }}>
          <Typography color="text.secondary">
            Select filters and click "Generate Pick List" to view aggregated product counts by courier.
          </Typography>
        </Paper>
      )}
    </Box>
  );
}

export default PickList;
