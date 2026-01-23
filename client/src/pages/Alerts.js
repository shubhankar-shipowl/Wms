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
  Pagination,
  Tooltip,
  Alert,
  CircularProgress,
} from "@mui/material";
import {
  Search,
  Refresh,
  Warning,
  Error as ErrorIcon,
  Info,
  TrendingDown,
  AccessTime,
  Inventory as InventoryIcon,
  CheckCircle,
  Cancel,
} from "@mui/icons-material";
import { useQuery, useMutation, useQueryClient } from "react-query";
import axios from "axios";
import { format } from "date-fns";
import LoadingSpinner from "../components/Common/LoadingSpinner";

const MetricCard = ({ title, value, icon, color = "primary", subtitle }) => (
  <Card>
    <CardContent>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Box>
          <Typography color="text.secondary" gutterBottom variant="body2">
            {title}
          </Typography>
          <Typography variant="h4" component="div" color={`${color}.main`}>
            {value}
          </Typography>
          {subtitle && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              {subtitle}
            </Typography>
          )}
        </Box>
        <Box sx={{ color: `${color}.main` }}>{icon}</Box>
      </Box>
    </CardContent>
  </Card>
);

const Alerts = () => {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [alertLevelFilter, setAlertLevelFilter] = useState("all");
  const [sortBy, setSortBy] = useState("days_until_stockout");
  const [selectedProductId, setSelectedProductId] = useState("");

  const queryClient = useQueryClient();

  // Fetch products list for dropdown
  const { data: productsData } = useQuery(
    "products-list-alerts",
    () => axios.get("/api/products?limit=1000").then((res) => res.data),
    {
      staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    }
  );

  const products = productsData?.data?.products || [];

  // Fetch alerts summary
  const {
    data: summaryData,
    isLoading: summaryLoading,
    refetch: refetchSummary,
  } = useQuery(
    "alerts-summary",
    () => axios.get("/api/alerts/summary").then((res) => res.data),
    {
      refetchInterval: 30000, // Refetch every 30 seconds
    }
  );

  // Fetch alerts list
  const {
    data: alertsData,
    isLoading: alertsLoading,
    refetch: refetchAlerts,
  } = useQuery(
    ["alerts-list", page, search, alertLevelFilter],
    () =>
      axios
        .get("/api/alerts/low-stock", {
          params: {
            page,
            limit: 20,
          },
        })
        .then((res) => res.data),
    {
      refetchInterval: 30000,
    }
  );

  // Manual refresh
  const handleRefresh = () => {
    refetchSummary();
    refetchAlerts();
  };

  // Filter alerts based on search, level, and product
  const filteredAlerts = alertsData?.data?.alerts?.filter((alert) => {
    const matchesSearch =
      !search ||
      alert.product_name?.toLowerCase().includes(search.toLowerCase()) ||
      alert.product_sku?.toLowerCase().includes(search.toLowerCase());
    const matchesLevel =
      alertLevelFilter === "all" || alert.alert_level === alertLevelFilter;
    const matchesProduct =
      !selectedProductId || alert.product_id === parseInt(selectedProductId);
    return matchesSearch && matchesLevel && matchesProduct;
  }) || [];

  // Sort alerts
  const sortedAlerts = [...filteredAlerts].sort((a, b) => {
    switch (sortBy) {
      case "days_until_stockout":
        if (a.days_until_stockout === null) return 1;
        if (b.days_until_stockout === null) return -1;
        return a.days_until_stockout - b.days_until_stockout;
      case "current_stock":
        return a.current_stock - b.current_stock;
      case "product_name":
        return a.product_name.localeCompare(b.product_name);
      default:
        return 0;
    }
  });

  const getAlertLevelColor = (level) => {
    switch (level) {
      case "critical":
        return "error";
      case "low":
        return "warning";
      default:
        return "default";
    }
  };

  const getAlertLevelIcon = (level) => {
    switch (level) {
      case "critical":
        return <ErrorIcon fontSize="small" />;
      case "low":
        return <Warning fontSize="small" />;
      default:
        return <Info fontSize="small" />;
    }
  };

  if (summaryLoading || alertsLoading) {
    return <LoadingSpinner />;
  }

  const summary = summaryData?.data || {};
  const alerts = sortedAlerts || [];
  const pagination = alertsData?.data?.pagination || {};

  // Check if any filters are active
  const hasActiveFilters = selectedProductId || search || alertLevelFilter !== "all";

  return (
    <Box sx={{ p: 3 }}>
      {/* Header */}
      <Box sx={{ mb: 3, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Typography variant="h4" component="h1" gutterBottom>
          Low Stock Alerts
        </Typography>
        <Button
          variant="outlined"
          startIcon={<Refresh />}
          onClick={handleRefresh}
        >
          Refresh
        </Button>
      </Box>

      {/* Summary Cards */}
      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} md={3}>
          <MetricCard
            title="Critical Alerts"
            value={summary.critical_alerts || 0}
            icon={<ErrorIcon />}
            color="error"
            subtitle="Out of stock or ≤3 days"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <MetricCard
            title="Forecast Alerts"
            value={summary.forecast_alerts || 0}
            icon={<Warning />}
            color="warning"
            subtitle="Will run out in 15 days"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <MetricCard
            title="Total Alerts"
            value={(summary.critical_alerts || 0) + (summary.forecast_alerts || 0)}
            icon={<InventoryIcon />}
            color="info"
            subtitle="Active alerts"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <MetricCard
            title="Normal Stock"
            value={summary.normal_stock || 0}
            icon={<CheckCircle />}
            color="success"
            subtitle="No alerts"
          />
        </Grid>
      </Grid>

      {/* Filters and Search */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={12} md={3}>
              <FormControl fullWidth>
                <InputLabel>Product</InputLabel>
                <Select
                  value={selectedProductId}
                  label="Product"
                  onChange={(e) => {
                    setSelectedProductId(e.target.value);
                    setPage(1); // Reset to first page when filter changes
                  }}
                >
                  <MenuItem value="">
                    <em>All Products</em>
                  </MenuItem>
                  {products.map((product) => (
                    <MenuItem key={product.id} value={product.id}>
                      {product.name} ({product.sku})
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} md={3}>
              <TextField
                fullWidth
                placeholder="Search by product name or SKU..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1); // Reset to first page when search changes
                }}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <Search />
                    </InputAdornment>
                  ),
                }}
              />
            </Grid>
            <Grid item xs={12} sm={6} md={2}>
              <FormControl fullWidth>
                <InputLabel>Alert Level</InputLabel>
                <Select
                  value={alertLevelFilter}
                  label="Alert Level"
                  onChange={(e) => {
                    setAlertLevelFilter(e.target.value);
                    setPage(1); // Reset to first page when filter changes
                  }}
                >
                  <MenuItem value="all">All Levels</MenuItem>
                  <MenuItem value="critical">Critical</MenuItem>
                  <MenuItem value="low">Low</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={6} md={2}>
              <FormControl fullWidth>
                <InputLabel>Sort By</InputLabel>
                <Select
                  value={sortBy}
                  label="Sort By"
                  onChange={(e) => setSortBy(e.target.value)}
                >
                  <MenuItem value="days_until_stockout">Days Until Stockout</MenuItem>
                  <MenuItem value="current_stock">Current Stock</MenuItem>
                  <MenuItem value="product_name">Product Name</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} md={2}>
              <Button
                fullWidth
                variant="contained"
                onClick={() => {
                  axios.post("/api/alerts/check-low-stock").then(() => {
                    handleRefresh();
                  });
                }}
              >
                Check Now
              </Button>
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      {/* Alerts Table */}
      {alerts.length === 0 ? (
        <Alert severity="info" sx={{ mb: 3 }}>
          No alerts found. All products have sufficient stock or no forecast data available.
        </Alert>
      ) : (
        <>
          <TableContainer component={Paper}>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Product</TableCell>
                  <TableCell>SKU</TableCell>
                  <TableCell align="right">Current Stock</TableCell>
                  <TableCell align="right">Avg Daily Consumption</TableCell>
                  <TableCell align="right">Days Until Stockout</TableCell>
                  <TableCell align="center">Alert Level</TableCell>
                  <TableCell>Last Updated</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {alerts.map((alert) => (
                  <TableRow
                    key={alert.product_id}
                    sx={{
                      "&:hover": { backgroundColor: "action.hover" },
                      backgroundColor:
                        alert.alert_level === "critical"
                          ? "rgba(211, 47, 47, 0.08)"
                          : "transparent",
                    }}
                  >
                    <TableCell>
                      <Typography variant="body2" fontWeight="medium">
                        {alert.product_name}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" color="text.secondary">
                        {alert.product_sku}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Typography
                        variant="body2"
                        fontWeight="bold"
                        color={
                          alert.current_stock === 0 ? "error.main" : "text.primary"
                        }
                      >
                        {alert.current_stock === 0 ? "Out of Stock" : alert.current_stock}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      {alert.avg_daily_consumption > 0 ? (
                        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 0.5 }}>
                          <TrendingDown fontSize="small" color="action" />
                          <Typography variant="body2">
                            {alert.avg_daily_consumption.toFixed(2)}/day
                          </Typography>
                        </Box>
                      ) : (
                        <Typography variant="body2" color="text.secondary">
                          No data
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell align="right">
                      {alert.days_until_stockout !== null ? (
                        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 0.5 }}>
                          <AccessTime fontSize="small" color="action" />
                          <Typography
                            variant="body2"
                            fontWeight="bold"
                            color={
                              alert.days_until_stockout <= 3
                                ? "error.main"
                                : alert.days_until_stockout <= 7
                                ? "warning.main"
                                : "text.primary"
                            }
                          >
                            {alert.days_until_stockout.toFixed(1)} days
                          </Typography>
                        </Box>
                      ) : (
                        <Typography variant="body2" color="text.secondary">
                          N/A
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell align="center">
                      <Chip
                        icon={getAlertLevelIcon(alert.alert_level)}
                        label={alert.alert_level?.toUpperCase() || "NORMAL"}
                        color={getAlertLevelColor(alert.alert_level)}
                        size="small"
                      />
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" color="text.secondary">
                        {alert.last_updated
                          ? format(new Date(alert.last_updated), "MMM dd, yyyy HH:mm")
                          : "N/A"}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>

          {/* Pagination - Only show when no filters are active */}
          {!hasActiveFilters && pagination.pages > 1 && (
            <Box sx={{ display: "flex", justifyContent: "center", mt: 3 }}>
              <Pagination
                count={pagination.pages}
                page={page}
                onChange={(event, value) => setPage(value)}
                color="primary"
              />
            </Box>
          )}

          {/* Results count */}
          <Typography variant="body2" color="text.secondary" sx={{ mt: 2, textAlign: "center" }}>
            {hasActiveFilters 
              ? `Showing ${alerts.length} filtered alert${alerts.length !== 1 ? 's' : ''}`
              : `Showing ${alerts.length} of ${pagination.total || 0} alerts`
            }
          </Typography>
        </>
      )}
    </Box>
  );
};

export default Alerts;
