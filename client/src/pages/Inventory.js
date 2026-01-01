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
  Tabs,
  Tab,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from "@mui/material";
import {
  Search,
  Refresh,
  Warning,
  TrendingUp,
  CurrencyRupee,
  Inventory as InventoryIcon,
  QrCode,
} from "@mui/icons-material";
import { useQuery } from "react-query";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
} from "recharts";
import axios from "axios";
import { format } from "date-fns";
import LoadingSpinner from "../components/Common/LoadingSpinner";
import { useAuth } from "../contexts/AuthContext";

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
          <Typography color="text.secondary" gutterBottom variant="h6">
            {title}
          </Typography>
          <Typography variant="h4" component="div">
            {value}
          </Typography>
          {subtitle && (
            <Typography variant="body2" color="text.secondary">
              {subtitle}
            </Typography>
          )}
        </Box>
        <Box sx={{ color: `${color}.main` }}>{icon}</Box>
      </Box>
    </CardContent>
  </Card>
);

const Inventory = () => {
  const [search, setSearch] = useState("");
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [barcodeDialogOpen, setBarcodeDialogOpen] = useState(false);
  const [tabValue, setTabValue] = useState(0);
  const { isAdmin } = useAuth();

  // Get inventory overview
  const {
    data: overviewData,
    isLoading: overviewLoading,
    refetch: refetchOverview,
  } = useQuery(
    "inventory-overview",
    () => axios.get("/api/inventory/overview").then((res) => res.data),
    {
      refetchInterval: 30000, // Refresh every 30 seconds
    }
  );

  // Get stock levels
  const {
    data: stockData,
    isLoading: stockLoading,
    refetch: refetchStock,
  } = useQuery(
    ["stock-levels", search, lowStockOnly],
    () =>
      axios
        .get("/api/inventory", {
          params: { search, limit: 50, low_stock_only: lowStockOnly },
        })
        .then((res) => res.data),
    {
      keepPreviousData: true,
    }
  );

  // Get inventory valuation - TODO: Implement valuation endpoint
  // const { data: valuationData, isLoading: valuationLoading } = useQuery(
  //   "inventory-valuation",
  //   () => axios.get("/api/inventory/valuation").then((res) => res.data)
  // );

  // Get inventory analytics
  const { data: analyticsData } = useQuery("inventory-analytics", () =>
    axios.get("/api/inventory/analytics?period=30").then((res) => res.data)
  );

  const handleViewBarcodes = async (productId) => {
    try {
      const response = await axios.get(`/api/barcodes?product_id=${productId}`);
      setSelectedProduct({
        id: productId,
        barcodes: response.data.data.barcodes || [],
      });
      setBarcodeDialogOpen(true);
    } catch (error) {
      console.error("Error fetching barcodes:", error);
    }
  };

  const handleRefresh = () => {
    refetchOverview();
    refetchStock();
  };

  if (overviewLoading || stockLoading) {
    return <LoadingSpinner message="Loading inventory data..." />;
  }

  const overview = overviewData?.data || {};
  const stockLevels = stockData?.data?.inventory || [];
  // const valuation = valuationData?.data?.valuation || [];
  const analytics = analyticsData?.data || {};

  // Prepare chart data - using analytics trends
  const movementData =
    analytics.trends?.reduce((acc, item) => {
      const date = format(new Date(item.date), "MMM dd");
      let existing = acc.find((d) => d.date === date);

      if (existing) {
        existing.in = existing.in || 0;
        existing.out = existing.out || 0;
        if (item.transaction_type === "in") {
          existing.in += parseInt(item.total_quantity);
        } else if (item.transaction_type === "out") {
          existing.out += parseInt(item.total_quantity);
        }
      } else {
        acc.push({
          date,
          in:
            item.transaction_type === "in" ? parseInt(item.total_quantity) : 0,
          out:
            item.transaction_type === "out" ? parseInt(item.total_quantity) : 0,
        });
      }

      return acc;
    }, []) || [];

  // Prepare top products data for analytics
  const topProductsData =
    analytics.topProducts
      ?.map((product, index) => ({
        name: product.name,
        sku: product.sku,
        movement: parseInt(product.total_movement) || 0,
        value:
          (parseFloat(product.price) || 0) *
          (parseInt(product.stock_quantity) || 0),
        rank: index + 1,
      }))
      .slice(0, 8) || [];

  // Ensure we have at least some data for charts
  const hasMovementData = movementData && movementData.length > 0;
  const hasTopProductsData = topProductsData && topProductsData.length > 0;

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
          Inventory Management
        </Typography>
        <Button
          variant="outlined"
          startIcon={<Refresh />}
          onClick={handleRefresh}
        >
          Refresh
        </Button>
      </Box>

      {/* Key Metrics */}
      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} md={isAdmin ? 3 : 4}>
          <MetricCard
            title="Total Products"
            value={overview.totalProducts || 0}
            icon={<InventoryIcon fontSize="large" />}
            color="primary"
          />
        </Grid>
        {isAdmin && (
          <Grid item xs={12} sm={6} md={3}>
            <MetricCard
              title="Inventory Value"
              value={`${(overview.totalStockValue || 0).toLocaleString()}`}
              icon={<CurrencyRupee fontSize="large" />}
              color="success"
            />
          </Grid>
        )}
        <Grid item xs={12} sm={6} md={isAdmin ? 3 : 4}>
          <MetricCard
            title="Low Stock Items"
            value={overview.lowStockCount || 0}
            icon={<Warning fontSize="large" />}
            color="error"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={isAdmin ? 3 : 4}>
          <MetricCard
            title="Recent Activity"
            value={overview.recentTransactions || 0}
            icon={<TrendingUp fontSize="large" />}
            color="info"
            subtitle="Last 24 hours"
          />
        </Grid>
      </Grid>

      {/* Tabs for different views */}
      <Box sx={{ borderBottom: 1, borderColor: "divider", mb: 3 }}>
        <Tabs
          value={tabValue}
          onChange={(e, newValue) => setTabValue(newValue)}
        >
          <Tab label="Stock Levels" />
          <Tab label="Analytics" />
          <Tab label="Valuation" />
        </Tabs>
      </Box>

      {/* Stock Levels Tab */}
      {tabValue === 0 && (
        <Box>
          {/* Filters */}
          <Box sx={{ display: "flex", gap: 2, mb: 3, flexWrap: "wrap" }}>
            <TextField
              placeholder="Search products..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <Search />
                  </InputAdornment>
                ),
              }}
              sx={{ minWidth: 300 }}
            />
            <FormControl sx={{ minWidth: 150 }}>
              <InputLabel>Filter</InputLabel>
              <Select
                value={lowStockOnly ? "low" : "all"}
                onChange={(e) => setLowStockOnly(e.target.value === "low")}
                label="Filter"
              >
                <MenuItem value="all">All Products</MenuItem>
                <MenuItem value="low">Low Stock Only</MenuItem>
              </Select>
            </FormControl>
          </Box>

          {/* Stock Levels Table */}
          <TableContainer component={Paper}>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Product</TableCell>
                  <TableCell>SKU</TableCell>
                  <TableCell align="right">Current Stock</TableCell>
                  <TableCell align="right">Threshold</TableCell>
                  {isAdmin && <TableCell align="right">Stock Value</TableCell>}
                  <TableCell align="center">Status</TableCell>
                  <TableCell align="center">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {stockLevels.map((product) => (
                  <TableRow key={product.id}>
                    <TableCell>
                      <Typography variant="subtitle2">
                        {product.name}
                      </Typography>
                    </TableCell>
                    <TableCell>{product.sku}</TableCell>
                    <TableCell align="right">
                      <Typography
                        variant="body2"
                        color={
                          product.current_stock <= product.low_stock_threshold
                            ? "error"
                            : "text.primary"
                        }
                        fontWeight="bold"
                      >
                        {product.current_stock}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      {product.low_stock_threshold}
                    </TableCell>
                    {isAdmin && (
                      <TableCell align="right">
                        ₹
                        {(
                          parseFloat(product.price) * product.current_stock
                        ).toFixed(2)}
                      </TableCell>
                    )}
                    <TableCell align="center">
                      {product.stock_status === "low" ||
                      product.stock_status === "critical" ? (
                        <Chip
                          label={
                            product.stock_status === "critical"
                              ? "Critical"
                              : "Low Stock"
                          }
                          color="error"
                          size="small"
                          icon={<Warning />}
                        />
                      ) : (
                        <Chip label="In Stock" color="success" size="small" />
                      )}
                    </TableCell>
                    <TableCell align="center">
                      <IconButton
                        size="small"
                        onClick={() => handleViewBarcodes(product.id)}
                        title="View Barcodes"
                      >
                        <QrCode />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>

          {stockLevels.length === 0 && (
            <Box sx={{ textAlign: "center", py: 4 }}>
              <Typography variant="h6" color="text.secondary">
                {search || lowStockOnly
                  ? "No products found matching your criteria"
                  : "No products available"}
              </Typography>
            </Box>
          )}
        </Box>
      )}

      {/* Analytics Tab */}
      {tabValue === 1 && (
        <Grid container spacing={3}>
          <Grid item xs={12} lg={8}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Stock Movement Trends (Last 30 Days)
                </Typography>
                {hasMovementData ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <LineChart data={movementData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" />
                      <YAxis />
                      <Tooltip />
                      <Line
                        type="monotone"
                        dataKey="in"
                        stroke="#4caf50"
                        strokeWidth={2}
                        name="Stock IN"
                      />
                      <Line
                        type="monotone"
                        dataKey="out"
                        stroke="#f44336"
                        strokeWidth={2}
                        name="Stock OUT"
                      />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <Box
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      height: 300,
                    }}
                  >
                    <Typography variant="body2" color="text.secondary">
                      No movement data available for the selected period
                    </Typography>
                  </Box>
                )}
              </CardContent>
            </Card>
          </Grid>

          <Grid item xs={12} lg={4}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Top Products by Movement
                </Typography>
                {hasTopProductsData ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={topProductsData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="sku" />
                      <YAxis />
                      <Tooltip />
                      <Bar dataKey="movement" fill="#1976d2" />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <Box
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      height: 300,
                    }}
                  >
                    <Typography variant="body2" color="text.secondary">
                      No product movement data available
                    </Typography>
                  </Box>
                )}
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}

      {/* Valuation Tab */}
      {tabValue === 2 && (
        <Box>
          {false ? (
            <LoadingSpinner message="Loading valuation data..." />
          ) : (
            <Grid container spacing={3}>
              <Grid item xs={12} md={8}>
                <Card>
                  <CardContent>
                    <Typography variant="h6" gutterBottom>
                      Inventory Valuation Report
                    </Typography>
                    <TableContainer>
                      <Table>
                        <TableHead>
                          <TableRow>
                            <TableCell>Product</TableCell>
                            <TableCell>SKU</TableCell>
                            {isAdmin && <TableCell align="right">Unit Price</TableCell>}
                            <TableCell align="right">Stock Quantity</TableCell>
                            {isAdmin && <TableCell align="right">Total Value</TableCell>}
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {stockLevels.map((item) => (
                            <TableRow key={item.id}>
                              <TableCell>{item.name}</TableCell>
                              <TableCell>{item.sku}</TableCell>
                              {isAdmin && (
                                <TableCell align="right">₹{item.price}</TableCell>
                              )}
                              <TableCell align="right">
                                {item.current_stock}
                              </TableCell>
                              {isAdmin && (
                                <TableCell align="right">
                                  <Typography
                                    variant="subtitle2"
                                    fontWeight="bold"
                                  >
                                    ₹
                                    {(
                                      parseFloat(item.price) * item.current_stock
                                    ).toFixed(2)}
                                  </Typography>
                                </TableCell>
                              )}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  </CardContent>
                </Card>
              </Grid>

              {isAdmin && (
                <Grid item xs={12} md={4}>
                  <Card>
                    <CardContent>
                      <Typography variant="h6" gutterBottom>
                        Total Inventory Value
                      </Typography>
                      <Typography variant="h3" color="primary" gutterBottom>
                        ₹{overview.totalStockValue?.toLocaleString() || "0"}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Based on current stock levels and unit prices
                      </Typography>
                    </CardContent>
                  </Card>
                </Grid>
              )}
            </Grid>
          )}
        </Box>
      )}

      {/* Barcode Details Dialog */}
      <Dialog
        open={barcodeDialogOpen}
        onClose={() => setBarcodeDialogOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          Barcode Details - Product ID: {selectedProduct?.id}
        </DialogTitle>
        <DialogContent>
          {selectedProduct?.barcodes && (
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>Barcode</TableCell>
                    <TableCell align="right">Units Assigned</TableCell>
                    <TableCell align="right">Current Stock</TableCell>
                    <TableCell>Last Updated</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {selectedProduct.barcodes.map((barcode) => (
                    <TableRow key={barcode.id}>
                      <TableCell>
                        <Typography variant="body2" fontFamily="monospace">
                          {barcode.barcode}
                        </Typography>
                      </TableCell>
                      <TableCell align="right">
                        {barcode.units_assigned}
                      </TableCell>
                      <TableCell align="right">
                        {barcode.current_stock}
                      </TableCell>
                      <TableCell>
                        {barcode.last_updated
                          ? format(
                              new Date(barcode.last_updated),
                              "MMM dd, yyyy HH:mm"
                            )
                          : "N/A"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBarcodeDialogOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default Inventory;
