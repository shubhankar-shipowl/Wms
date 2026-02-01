import React, { useState, useEffect } from 'react';
import { 
  Box, Typography, Button, TextField, FormControl, 
  InputLabel, Select, MenuItem, Stack, Paper, 
  Tabs, Tab
} from '@mui/material';
import { Add, Upload as UploadIcon, FilterList, Refresh, Clear } from '@mui/icons-material';
import axios from 'axios';
import { useQuery } from 'react-query';

import LabelsHierarchy from '../components/Labels/LabelsHierarchy';
import LabelsUpload from '../components/Labels/LabelsUpload';
import StatsDashboard from '../components/Labels/StatsDashboard';
import LoadingSpinner from '../components/Common/LoadingSpinner';

const Labels = () => {
  const [tab, setTab] = useState(0); // 0: Browse, 1: Upload
  const [storeFilter, setStoreFilter] = useState('');
  const [courierFilter, setCourierFilter] = useState('');
  const [productFilter, setProductFilter] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  
  // Fetch Stats
  const { data: statsData, refetch: refetchStats } = useQuery(
    'labels-stats', 
    () => axios.get('/api/labels/stats').then(res => res.data)
  );

  // Fetch Couriers based on selected store
  const { data: couriersData } = useQuery(
    ['labels-couriers', storeFilter],
    () => axios.get('/api/labels/couriers', {
      params: {
        store: storeFilter || undefined
      }
    }).then(res => res.data),
    {
      keepPreviousData: true
    }
  );

  // Fetch Products based on selected store and courier
  const { data: productsData } = useQuery(
    ['labels-products', storeFilter, courierFilter],
    () => axios.get('/api/labels/products', {
      params: {
        store: storeFilter || undefined,
        courier: courierFilter || undefined
      }
    }).then(res => res.data),
    {
      keepPreviousData: true
    }
  );

  // Reset courier and product filter when store changes
  const handleStoreChange = (value) => {
    setStoreFilter(value);
    setCourierFilter(''); // Reset courier when store changes
    setProductFilter(''); // Reset product when store changes
  };

  const handleCourierChange = (value) => {
    setCourierFilter(value);
    setProductFilter(''); // Reset product when courier changes
  };

  // Fetch Hierarchy
  const { 
    data: hierarchyData, 
    isLoading, 
    isFetching,
    refetch: refetchHierarchy 
  } = useQuery(
    ['labels-hierarchy', storeFilter, courierFilter, productFilter],
    () => {
      const endDateTime = endDate ? new Date(endDate) : undefined;
      if (endDateTime) {
        endDateTime.setHours(23, 59, 59, 999);
      }
      
      return axios.get('/api/labels/hierarchy', {
        params: {
          store: storeFilter,
          courier: courierFilter,
          product: productFilter,
          startDate: startDate ? new Date(startDate).toISOString() : undefined,
          endDate: endDateTime ? endDateTime.toISOString() : undefined
        }
      }).then(res => res.data);
    }
  );

  const handleRefresh = async () => {
    await Promise.all([
      refetchStats(),
      refetchHierarchy()
    ]);
  };

  const handleDelete = async (id) => {
    if (window.confirm('Are you sure you want to delete this label?')) {
      try {
        await axios.delete(`/api/labels/${id}`);
        handleRefresh();
      } catch (error) {
        console.error(error);
        alert('Failed to delete label');
      }
    }
  };

  const handleBulkDelete = async () => {
    if (!startDate || !endDate) {
      alert('Please select start and end dates');
      return;
    }

    // Fix: Set end date to end of day (23:59:59) to ensure full day coverage
    const endDateTime = new Date(endDate);
    endDateTime.setHours(23, 59, 59, 999);
    
    // Safety check: confirm mass deletion
    if (window.confirm(`Are you sure you want to delete ALL labels from ${startDate} to ${endDate}? This cannot be undone.`)) {
      try {
        const res = await axios.delete('/api/labels', {
          params: { 
            startDate: new Date(startDate).toISOString(), 
            endDate: endDateTime.toISOString() 
          }
        });
        alert(res.data.message);
        handleRefresh();
      } catch (error) {
        console.error(error);
        alert('Bulk deletion failed: ' + (error.response?.data?.message || error.message));
      }
    }
  };

  const handleDownload = async (type, value, storeName, startParam, endParam) => {
    try {
      const response = await axios.post('/api/labels/download', {
        [type]: value,
        ...(type === 'courier' && storeName ? { store: storeName } : {}),
        startDate: startParam,
        endDate: endParam
      }, {
        responseType: 'blob'
      });
      
      // Generate filename based on type
      let filename = 'labels.zip';
      if (type === 'courier' && storeName) {
        filename = `${storeName}-${value}.zip`;
      } else if (type === 'store') {
        filename = `${value}.zip`;
      }
      
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      link.parentNode.removeChild(link);
    } catch (error) {
      console.error(error);
      alert('Download failed');
    }
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4">Label Management</Typography>
        <Button 
          startIcon={<Refresh />} 
          onClick={handleRefresh}
          disabled={isFetching}
        >
          {isFetching ? 'Refreshing...' : 'Refresh'}
        </Button>
      </Box>

      {/* Stats Section */}
      <StatsDashboard stats={statsData?.data} />

      <Paper sx={{ mb: 3 }}>
        <Tabs 
          value={tab} 
          onChange={(e, v) => setTab(v)}
          indicatorColor="primary"
          textColor="primary"
          variant="fullWidth"
        >
          <Tab label="Browse Labels" />
          <Tab label="Upload New" />
        </Tabs>
      </Paper>

      {tab === 0 && (
        <Box>
          {/* Filters */}
          {/* Filters & Actions */}
          <Paper sx={{ p: 2, mb: 3 }}>
            <Stack spacing={3}>
              {/* Filters */}
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems="center">
                
                <FormControl size="small" sx={{ minWidth: 200 }}>
                  <InputLabel shrink>Store</InputLabel>
                  <Select
                    value={storeFilter}
                    label="Store"
                    onChange={(e) => handleStoreChange(e.target.value)}
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
                    {statsData?.data?.stores_breakdown?.map(store => (
                       <MenuItem key={store.store_name} value={store.store_name}>
                         {store.store_name}
                       </MenuItem>
                    ))}
                  </Select>
                </FormControl>

                <FormControl size="small" sx={{ minWidth: 200 }}>
                  <InputLabel shrink>Courier</InputLabel>
                  <Select
                    value={courierFilter}
                    label="Courier"
                    onChange={(e) => handleCourierChange(e.target.value)}
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
                    {couriersData?.couriers?.map(courier => (
                       <MenuItem key={courier.courier_name} value={courier.courier_name}>
                         {courier.courier_name} ({courier.count})
                       </MenuItem>
                    ))}
                  </Select>
                </FormControl>

                <FormControl size="small" sx={{ minWidth: 250 }}>
                  <InputLabel shrink>Product</InputLabel>
                  <Select
                    value={productFilter}
                    label="Product"
                    onChange={(e) => setProductFilter(e.target.value)}
                    displayEmpty
                    notched
                    renderValue={(selected) => {
                      if (selected === '') {
                        return 'All Products';
                      }
                      // Truncate long product names in display
                      return selected.length > 25 ? selected.substring(0, 25) + '...' : selected;
                    }}
                  >
                    <MenuItem value="">All Products</MenuItem>
                    {productsData?.products?.map(product => (
                       <MenuItem key={product.product_name} value={product.product_name}>
                         {product.product_name} ({product.count})
                       </MenuItem>
                    ))}
                  </Select>
                </FormControl>

                {(storeFilter || courierFilter || productFilter) && (
                  <Button
                    variant="outlined"
                    size="small"
                    startIcon={<Clear />}
                    onClick={() => {
                      setStoreFilter('');
                      setCourierFilter('');
                      setProductFilter('');
                    }}
                    sx={{ textTransform: 'none' }}
                  >
                    Clear Filters
                  </Button>
                )}
              </Stack>

              {/* Bulk Actions Section */}
              <Box sx={{ borderTop: 1, borderColor: 'divider', pt: 2 }}>
                <Typography variant="subtitle2" sx={{ mb: 1, color: 'text.secondary', fontWeight: 'bold' }}>
                  BULK ACTIONS
                </Typography>
                <Stack spacing={2}>
                    {/* Date Range & Delete */}
                    <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems="center">
                      <TextField 
                        label="From Date" 
                        type="date"
                        size="small"
                        InputLabelProps={{ shrink: true }}
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        sx={{ width: 180 }}
                      />
                      <Typography variant="body2" color="text.secondary">to</Typography>
                      <TextField 
                        label="To Date" 
                        type="date"
                        size="small"
                        InputLabelProps={{ shrink: true }}
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                         sx={{ width: 180 }}
                      />
                      
                      <Button 
                        variant="contained" 
                        color="error"
                        onClick={handleBulkDelete}
                        disabled={!startDate || !endDate}
                        startIcon={<FilterList />}
                      >
                        Delete Labels in Range
                      </Button>
                    </Stack>

                    {/* Quick Download by Courier */}
                    <Box>
                        <Typography variant="caption" display="block" sx={{ mb: 1, color: 'text.secondary' }}>
                            QUICK DOWNLOAD BY COURIER (Applies to selected date range)
                        </Typography>
                        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                            {statsData?.data?.couriers_breakdown?.map((courier) => (
                                <Button
                                    key={courier.courier_name}
                                    variant="outlined"
                                    size="small"
                                    startIcon={<UploadIcon sx={{ transform: 'rotate(180deg)' }} />} // Using upload icon rotated as download
                                    onClick={() => {
                                         if (!startDate || !endDate) {
                                            if(!window.confirm("No date range selected. This will download ALL labels for this courier ever created. Continue?")) return;
                                         }
                                         // Pass dates if they exist, otherwise undefined (API handles logic)
                                         // Pass value as date strings
                                         const start = startDate ? new Date(startDate).toISOString() : undefined;
                                         const end = endDate ? new Date(endDate).toISOString() : undefined;
                                         // If end date is set, make sure it covers the full day
                                         if (end) {
                                             const e = new Date(end);
                                             e.setHours(23, 59, 59, 999);
                                             handleDownload('courier', courier.courier_name, null, start, e.toISOString());
                                         } else {
                                             handleDownload('courier', courier.courier_name, null, start, undefined); 
                                         }
                                    }}
                                >
                                    {courier.courier_name} ({courier.count})
                                </Button>
                            ))}
                            {(!statsData?.data?.couriers_breakdown || statsData.data.couriers_breakdown.length === 0) && (
                                <Typography variant="caption" color="text.secondary" fontStyle="italic">
                                    No courier data available yet.
                                </Typography>
                            )}
                        </Stack>
                    </Box>
                </Stack>
              </Box>
            </Stack>
          </Paper>

          {/* Hierarchy View */}
          {isLoading || isFetching ? (
            <LoadingSpinner /> 
          ) : (
            <LabelsHierarchy 
              data={hierarchyData?.stores} 
              onView={() => {}}
              onDownload={handleDownload}
              onDelete={handleDelete}
            />
          )}
        </Box>
      )}

      {tab === 1 && (
        <LabelsUpload 
          onUploadSuccess={async () => {
            await handleRefresh();
            setTab(0); // Switch back to browse after upload
          }}    
        />
      )}
    </Box>
  );
};

export default Labels;
