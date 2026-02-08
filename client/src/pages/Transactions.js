import React, { useState } from "react";
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
  Chip,
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
  Pagination,
  Autocomplete,
} from "@mui/material";
import {
  Search,
  Refresh,
  Download,
  Visibility,
  FilterList,
  Clear,
} from "@mui/icons-material";
import { useQuery } from "react-query";
import axios from "axios";
import { format } from "date-fns";
import LoadingSpinner from "../components/Common/LoadingSpinner";

const Transactions = () => {
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState({
    product_id: "",
    type: "",
    start_date: "",
    end_date: "",
    user_id: "",
  });
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);
  const [selectedTransaction, setSelectedTransaction] = useState(null);
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);

  // Get transactions
  const {
    data: transactionsData,
    isLoading,
    refetch,
  } = useQuery(
    ["transactions", page, limit, search, filters],
    () =>
      axios
        .get("/api/transactions", {
          params: {
            page: limit === -1 ? 1 : page,
            limit: limit === -1 ? 10000 : limit, // Use a large number for "All"
            ...filters,
            product_name: filters.product_id, // Map product_id to product_name for backend
            reference_number: search,
          },
        })
        .then((res) => res.data),
    {
      keepPreviousData: true,
      refetchInterval: 30000, // Refetch every 30 seconds for real-time updates
    }
  );

  // Get transaction summary
  const { data: summaryData, isLoading: summaryLoading } = useQuery(
    [
      "transaction-summary",
      filters.product_id,
      filters.start_date,
      filters.end_date,
    ],
    () => {
      // Calculate days based on date range or use default 30 days
      let days = 30;
      if (filters.start_date && filters.end_date) {
        const startDate = new Date(filters.start_date);
        const endDate = new Date(filters.end_date);
        const diffTime = Math.abs(endDate - startDate);
        days = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1; // +1 to include both start and end dates
      } else if (filters.start_date) {
        const startDate = new Date(filters.start_date);
        const today = new Date();
        const diffTime = Math.abs(today - startDate);
        days = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
      }

      return axios
        .get(`/api/transactions/summary?days=${days}`, {
          params: {
            product_id: filters.product_id || undefined,
            start_date: filters.start_date || undefined,
            end_date: filters.end_date || undefined,
          },
        })
        .then((res) => {
          console.log("Transaction Summary API Response:", res.data);
          return res.data;
        });
    },
    {
      refetchInterval: 30000, // Refetch every 30 seconds for real-time updates
      staleTime: 0, // Always consider data stale to ensure fresh data
      cacheTime: 0, // Don't cache data to ensure fresh data
      refetchOnWindowFocus: true, // Refetch when window gains focus
      refetchOnMount: true, // Refetch when component mounts
    }
  );

  // Get products for dropdown
  const { data: productsData } = useQuery(
    "products-list",
    () => axios.get("/api/products?limit=1000").then((res) => res.data),
    {
      staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    }
  );

  const handleFilterChange = (field, value) => {
    setFilters((prev) => ({ ...prev, [field]: value }));
    setPage(1); // Reset to first page when filters change
  };

  const handleViewDetails = (transaction) => {
    setSelectedTransaction(transaction);
    setDetailDialogOpen(true);
  };

  const handleExportCSV = async () => {
    try {
      const response = await axios.get("/api/transactions/export/csv", {
        params: filters,
        responseType: "blob",
      });

      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute(
        "download",
        `transactions_${new Date().toISOString().split("T")[0]}.csv`
      );
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (error) {
      console.error("Export failed:", error);
    }
  };

  const handleRefresh = () => {
    refetch();
  };

  if (isLoading) {
    return <LoadingSpinner message="Loading transactions..." />;
  }

  const transactions = transactionsData?.data?.transactions || [];
  const pagination = transactionsData?.data?.pagination || {};
  const summary = summaryData?.data || {};

  // Debug log to see what summary data we have
  console.log("Summary data:", summary);
  console.log("Summary loading:", summaryLoading);

  return (
    <Box>
      <Box
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          mb: 3,
        }}
      >
        <Typography variant="h4" component="h1">
          Stock Transactions
        </Typography>
        <Box sx={{ display: "flex", gap: 2 }}>
          <Button
            variant="outlined"
            startIcon={<Download />}
            onClick={handleExportCSV}
          >
            Export CSV
          </Button>
          <Button
            variant="outlined"
            startIcon={<Refresh />}
            onClick={handleRefresh}
          >
            Refresh
          </Button>
        </Box>
      </Box>

      {/* Summary Cards */}
      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="text.secondary" gutterBottom>
                Total Transactions{" "}
                {filters.start_date && filters.end_date
                  ? `(${filters.start_date} to ${filters.end_date})`
                  : "(30 days)"}
              </Typography>
              <Typography variant="h4">
                {summaryLoading ? "..." : summary.total_transactions ?? 0}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="text.secondary" gutterBottom>
                Stock IN
              </Typography>
              <Typography variant="h4" color="success.main">
                {summaryLoading ? "..." : summary.stock_in ?? 0}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="text.secondary" gutterBottom>
                Stock OUT
              </Typography>
              <Typography variant="h4" color="error.main">
                {summaryLoading ? "..." : summary.stock_out ?? 0}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="text.secondary" gutterBottom>
                Total Quantity Moved
              </Typography>
              <Typography variant="h4" color="primary.main">
                {summaryLoading ? "..." : summary.total_quantity_moved ?? 0}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Filters */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Box sx={{ display: "flex", alignItems: "center", mb: 2 }}>
            <FilterList sx={{ mr: 1 }} />
            <Typography variant="h6">Filters</Typography>
          </Box>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6} md={3}>
              <TextField
                fullWidth
                label="Search Reference Number"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <Search />
                    </InputAdornment>
                  ),
                }}
              />
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <Autocomplete
                options={productsData?.data?.products || []}
                getOptionLabel={(option) =>
                  `${option.name} (${option.sku})`
                }
                value={
                  productsData?.data?.products?.find(
                    (p) => p.id === filters.product_id
                  ) || null
                }
                onChange={(e, newValue) =>
                  handleFilterChange("product_id", newValue ? newValue.id : "")
                }
                renderInput={(params) => (
                  <TextField {...params} label="Product" />
                )}
                isOptionEqualToValue={(option, value) =>
                  option.id === value.id
                }
                fullWidth
              />
            </Grid>
            <Grid item xs={12} sm={6} md={1.5}>
              <FormControl fullWidth>
                <InputLabel>Transaction Type</InputLabel>
                <Select
                  value={filters.type}
                  onChange={(e) => handleFilterChange("type", e.target.value)}
                  label="Transaction Type"
                >
                  <MenuItem value="">All Types</MenuItem>
                  <MenuItem value="in">Stock IN</MenuItem>
                  <MenuItem value="out">Stock OUT</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={6} md={1.5}>
              <TextField
                fullWidth
                label="Start Date"
                type="date"
                value={filters.start_date}
                onChange={(e) =>
                  handleFilterChange("start_date", e.target.value)
                }
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
            <Grid item xs={12} sm={6} md={1.5}>
              <TextField
                fullWidth
                label="End Date"
                type="date"
                value={filters.end_date}
                onChange={(e) => handleFilterChange("end_date", e.target.value)}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
            <Grid item xs={12} sm={6} md={1.5}>
              <TextField
                fullWidth
                label="Created By"
                value={filters.user_id}
                onChange={(e) => handleFilterChange("user_id", e.target.value)}
                placeholder="Username"
              />
            </Grid>
            <Grid item xs={12} sm={6} md={1.5}>
              <FormControl fullWidth>
                <InputLabel>Show Per Page</InputLabel>
                <Select
                  value={limit}
                  onChange={(e) => {
                    setLimit(e.target.value);
                    setPage(1); // Reset to first page when limit changes
                  }}
                  label="Show Per Page"
                >
                  <MenuItem value={20}>20</MenuItem>
                  <MenuItem value={50}>50</MenuItem>
                  <MenuItem value={100}>100</MenuItem>
                  <MenuItem value={200}>200</MenuItem>
                  <MenuItem value={-1}>All</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12}>
              <Box sx={{ display: "flex", justifyContent: "flex-end", mt: 2 }}>
                <Button
                  variant="outlined"
                  startIcon={<Clear />}
                  onClick={() => {
                    setFilters({
                      product_id: "",
                      type: "",
                      start_date: "",
                      end_date: "",
                      user_id: "",
                    });
                    setSearch("");
                    setPage(1);
                  }}
                  sx={{ mr: 1 }}
                >
                  Clear Filters
                </Button>
              </Box>
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      {/* Transactions Table */}
      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Date & Time</TableCell>
              <TableCell>Product</TableCell>
              <TableCell>Barcode</TableCell>
              <TableCell align="center">Type</TableCell>
              <TableCell align="right">Quantity</TableCell>
              <TableCell>Reference</TableCell>
              <TableCell>Created By</TableCell>
              <TableCell align="center">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {transactions.map((transaction) => (
              <TableRow key={transaction.id}>
                <TableCell>
                  <Typography variant="body2">
                    {format(new Date(transaction.created_at), "MMM dd, yyyy")}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {format(new Date(transaction.created_at), "HH:mm:ss")}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="subtitle2">
                    {transaction.product_name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    SKU: {transaction.product_sku}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="body2" fontFamily="monospace">
                    {transaction.barcode || "-"}
                  </Typography>
                </TableCell>
                <TableCell align="center">
                  <Chip
                    label={transaction.type === "in" ? "IN" : "OUT"}
                    color={transaction.type === "in" ? "success" : "error"}
                    size="small"
                  />
                </TableCell>
                <TableCell align="right">
                  <Typography variant="body2" fontWeight="bold">
                    {transaction.quantity}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="body2">
                    {transaction.reference_number || "-"}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="body2">
                    {transaction.created_by_username || "-"}
                  </Typography>
                </TableCell>
                <TableCell align="center">
                  <IconButton
                    size="small"
                    onClick={() => handleViewDetails(transaction)}
                    title="View Details"
                  >
                    <Visibility />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Pagination */}
      {limit !== -1 && pagination.totalPages > 1 && (
        <Box sx={{ display: "flex", justifyContent: "center", mt: 3 }}>
          <Pagination
            count={pagination.totalPages}
            page={page}
            onChange={(e, newPage) => setPage(newPage)}
            color="primary"
          />
        </Box>
      )}

      {/* Show total count when "All" is selected */}
      {limit === -1 && (
        <Box sx={{ display: "flex", justifyContent: "center", mt: 3 }}>
          <Typography variant="body2" color="text.secondary">
            Showing all {pagination.total || transactions.length} transactions
          </Typography>
        </Box>
      )}

      {transactions.length === 0 && (
        <Box sx={{ textAlign: "center", py: 4 }}>
          <Typography variant="h6" color="text.secondary">
            No transactions found matching your criteria
          </Typography>
        </Box>
      )}

      {/* Transaction Details Dialog */}
      <Dialog
        open={detailDialogOpen}
        onClose={() => setDetailDialogOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>Transaction Details</DialogTitle>
        <DialogContent>
          {selectedTransaction && (
            <Grid container spacing={2} sx={{ mt: 1 }}>
              <Grid item xs={12} sm={6}>
                <Typography variant="subtitle2" color="text.secondary">
                  Transaction ID
                </Typography>
                <Typography variant="body1">
                  {selectedTransaction.id}
                </Typography>
              </Grid>
              <Grid item xs={12} sm={6}>
                <Typography variant="subtitle2" color="text.secondary">
                  Date & Time
                </Typography>
                <Typography variant="body1">
                  {format(
                    new Date(selectedTransaction.created_at),
                    "MMM dd, yyyy HH:mm:ss"
                  )}
                </Typography>
              </Grid>
              <Grid item xs={12} sm={6}>
                <Typography variant="subtitle2" color="text.secondary">
                  Product
                </Typography>
                <Typography variant="body1">
                  {selectedTransaction.product_name} (
                  {selectedTransaction.product_sku})
                </Typography>
              </Grid>
              <Grid item xs={12} sm={6}>
                <Typography variant="subtitle2" color="text.secondary">
                  Barcode
                </Typography>
                <Typography variant="body1" fontFamily="monospace">
                  {selectedTransaction.barcode || "-"}
                </Typography>
              </Grid>
              <Grid item xs={12} sm={6}>
                <Typography variant="subtitle2" color="text.secondary">
                  Transaction Type
                </Typography>
                <Chip
                  label={selectedTransaction.type === "in" ? "IN" : "OUT"}
                  color={
                    selectedTransaction.type === "in" ? "success" : "error"
                  }
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <Typography variant="subtitle2" color="text.secondary">
                  Quantity
                </Typography>
                <Typography variant="body1" fontWeight="bold">
                  {selectedTransaction.quantity}
                </Typography>
              </Grid>
              <Grid item xs={12} sm={6}>
                <Typography variant="subtitle2" color="text.secondary">
                  Reference Number
                </Typography>
                <Typography variant="body1">
                  {selectedTransaction.reference_number || "N/A"}
                </Typography>
              </Grid>
              <Grid item xs={12} sm={6}>
                <Typography variant="subtitle2" color="text.secondary">
                  Created By
                </Typography>
                <Typography variant="body1">
                  {selectedTransaction.created_by_username || "System"}
                </Typography>
              </Grid>
              {selectedTransaction.notes && (
                <Grid item xs={12}>
                  <Typography variant="subtitle2" color="text.secondary">
                    Notes
                  </Typography>
                  <Typography variant="body1">
                    {selectedTransaction.notes}
                  </Typography>
                </Grid>
              )}
            </Grid>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDetailDialogOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default Transactions;
