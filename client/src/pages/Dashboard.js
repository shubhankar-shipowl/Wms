import React, { useState, useEffect } from "react";
import {
  Grid,
  Paper,
  Typography,
  Box,
  Card,
  CardContent,
  List,
  ListItem,
  ListItemText,
  Chip,
  Divider,
  Alert,
  Button,
} from "@mui/material";
import {
  TrendingUp,
  TrendingDown,
  Inventory,
  Warning,
  SwapHoriz,
  CurrencyRupee,
  Refresh,
} from "@mui/icons-material";
import { useQuery, useQueryClient } from "react-query";
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
  PieChart,
  Pie,
  Cell,
} from "recharts";
import axios from "axios";
import { format } from "date-fns";
import LoadingSpinner from "../components/Common/LoadingSpinner";
import { useAuth } from "../contexts/AuthContext";

const COLORS = ["#0088FE", "#00C49F", "#FFBB28", "#FF8042", "#8884D8"];

// Custom label component for pie chart
const CustomLabel = ({
  cx,
  cy,
  midAngle,
  innerRadius,
  outerRadius,
  percent,
  name,
}) => {
  const RADIAN = Math.PI / 180;
  const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);

  return (
    <text
      x={x}
      y={y}
      fill="white"
      textAnchor={x > cx ? "start" : "end"}
      dominantBaseline="central"
      fontSize={12}
      fontWeight="bold"
    >
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  );
};

// Custom responsive legend component
const CustomLegend = ({ data, colors }) => {
  const [isMobile, setIsMobile] = React.useState(false);

  React.useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };

    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  if (isMobile) {
    // Stack vertically on mobile
    return (
      <Box sx={{ mt: 2, display: "flex", flexDirection: "column", gap: 1 }}>
        {data.map((entry, index) => (
          <Box
            key={index}
            sx={{ display: "flex", alignItems: "center", gap: 1 }}
          >
            <Box
              sx={{
                width: 12,
                height: 12,
                borderRadius: "50%",
                backgroundColor: entry.color,
                flexShrink: 0,
              }}
            />
            <Typography
              variant="body2"
              sx={{ fontSize: "11px", fontWeight: 500 }}
            >
              {entry.name}
            </Typography>
          </Box>
        ))}
      </Box>
    );
  }

  // Horizontal layout for desktop
  return (
    <Box
      sx={{
        mt: 2,
        display: "flex",
        flexWrap: "wrap",
        justifyContent: "center",
        gap: 2,
      }}
    >
      {data.map((entry, index) => (
        <Box
          key={index}
          sx={{ display: "flex", alignItems: "center", gap: 0.5 }}
        >
          <Box
            sx={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              backgroundColor: entry.color,
              flexShrink: 0,
            }}
          />
          <Typography
            variant="body2"
            sx={{ fontSize: "11px", fontWeight: 500, whiteSpace: "nowrap" }}
          >
            {entry.name}
          </Typography>
        </Box>
      ))}
    </Box>
  );
};

const MetricCard = ({
  title,
  value,
  icon,
  color = "primary",
  trend,
  subtitle,
}) => (
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
      {trend && (
        <Box sx={{ display: "flex", alignItems: "center", mt: 1 }}>
          {trend > 0 ? (
            <TrendingUp color="success" fontSize="small" />
          ) : (
            <TrendingDown color="error" fontSize="small" />
          )}
          <Typography
            variant="body2"
            color={trend > 0 ? "success.main" : "error.main"}
            sx={{ ml: 0.5 }}
          >
            {Math.abs(trend)}%
          </Typography>
        </Box>
      )}
    </CardContent>
  </Card>
);

const Dashboard = () => {
  const { user, isAdmin, isManager } = useAuth();
  const queryClient = useQueryClient();
  const [lastUpdated, setLastUpdated] = useState(new Date());

  const {
    data: dashboardData,
    isLoading,
    error,
    refetch,
  } = useQuery(
    "dashboard",
    () => axios.get("/api/dashboard").then((res) => res.data),
    {
      refetchInterval: 10000, // Refetch every 10 seconds for real-time updates
      enabled: !!user, // Only fetch if user is logged in
      staleTime: 5000, // Consider data stale after 5 seconds
    }
  );

  // Update last updated time when data changes
  useEffect(() => {
    if (dashboardData) {
      setLastUpdated(new Date());
    }
  }, [dashboardData]);

  const { data: realtimeMetrics } = useQuery(
    "realtime-metrics",
    () => axios.get("/api/dashboard/metrics/realtime").then((res) => res.data),
    {
      refetchInterval: 30000, // Refetch every 30 seconds for real-time updates
      enabled: !!user, // Only fetch if user is logged in
      staleTime: 25000, // Consider data stale after 25 seconds
    }
  );

  // Show authentication message if user is not logged in
  if (!user) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="warning" sx={{ mb: 2 }}>
          Please log in to view the dashboard.
        </Alert>
      </Box>
    );
  }

  if (isLoading) {
    return <LoadingSpinner message="Loading dashboard..." />;
  }

  if (error) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error" sx={{ mb: 2 }}>
          Error loading dashboard: {error.message}
        </Alert>
        <Button onClick={() => refetch()} variant="contained">
          Retry
        </Button>
      </Box>
    );
  }

  const data = dashboardData?.data;
  const metrics = realtimeMetrics?.data || data?.metrics;

  // Prepare chart data
  const trendData =
    data?.trends?.reduce((acc, item) => {
      const date = format(new Date(item.date), "MMM dd");
      const existing = acc.find((d) => d.date === date);

      if (existing) {
        existing[item.transaction_type.toLowerCase()] = parseInt(
          item.total_quantity
        );
      } else {
        acc.push({
          date,
          [item.transaction_type.toLowerCase()]: parseInt(item.total_quantity),
          in:
            item.transaction_type === "in" ? parseInt(item.total_quantity) : 0,
          out:
            item.transaction_type === "out" ? parseInt(item.total_quantity) : 0,
        });
      }

      return acc;
    }, []) || [];

  // Stock distribution data for pie chart
  const stockDistribution =
    data?.topProductsByValue?.slice(0, 5).map((product, index) => ({
      name: product.name,
      value: parseFloat(product.stock_value),
      color: COLORS[index % COLORS.length],
    })) || [];

  // Most active products data for bar chart
  const mostActiveProducts =
    data?.topProductsByMovement?.slice(0, 8).map((product) => ({
      sku: product.sku,
      name: product.name,
      total_movement: parseInt(product.total_movement),
      total_in: parseInt(product.total_in),
      total_out: parseInt(product.total_out),
    })) || [];

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
          Dashboard
        </Typography>
        <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
          <Typography variant="body2" color="text.secondary">
            Last updated: {lastUpdated.toLocaleTimeString()}
          </Typography>
          <Button
            variant="outlined"
            startIcon={<Refresh />}
            onClick={() => {
              refetch();
              // Also refetch realtime metrics
              queryClient.refetchQueries("realtime-metrics");
            }}
            size="small"
          >
            Refresh
          </Button>
        </Box>
      </Box>

      {/* Key Metrics */}
      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} md={isAdmin ? 3 : 4}>
          <MetricCard
            title="Total Products"
            value={metrics?.total_products || 0}
            icon={<Inventory fontSize="large" />}
            color="primary"
          />
        </Grid>
        {isAdmin && (
          <Grid item xs={12} sm={6} md={3}>
            <MetricCard
              title="Inventory Value"
              value={`${(metrics?.total_inventory_value || 0).toLocaleString()}`}
              icon={<CurrencyRupee fontSize="large" />}
              color="success"
            />
          </Grid>
        )}
        <Grid item xs={12} sm={6} md={isAdmin ? 3 : 4}>
          <MetricCard
            title="Active Alerts"
            value={metrics?.active_alerts || 0}
            icon={<Warning fontSize="large" />}
            color="error"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={isAdmin ? 3 : 4}>
          <MetricCard
            title="Today's Transactions"
            value={metrics?.today_transactions || 0}
            icon={<SwapHoriz fontSize="large" />}
            color="info"
          />
        </Grid>
      </Grid>

      <Grid container spacing={3}>
        {/* Stock Movement Trends */}
        <Grid item xs={12} lg={8}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>
              Stock Movement Trends (Last 30 Days)
            </Typography>
            {trendData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={trendData}>
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
                  height: 300,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  border: "2px dashed #ccc",
                  borderRadius: 1,
                }}
              >
                <Typography variant="body1" color="text.secondary">
                  No transaction data available for the last 30 days
                </Typography>
              </Box>
            )}
          </Paper>
        </Grid>

        {/* Top Products by Value */}
        <Grid item xs={12} lg={4}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>
              Inventory Distribution
            </Typography>
            {stockDistribution.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={320}>
                  <PieChart>
                    <Pie
                      data={stockDistribution}
                      cx="50%"
                      cy="50%"
                      outerRadius={80}
                      innerRadius={20}
                      fill="#8884d8"
                      dataKey="value"
                      label={CustomLabel}
                      labelLine={false}
                    >
                      {stockDistribution.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value, name) => [
                        isAdmin ? `₹${value.toLocaleString()}` : "N/A",
                        name,
                      ]}
                      labelFormatter={(label) => `Product: ${label}`}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <CustomLegend data={stockDistribution} colors={COLORS} />
              </>
            ) : (
              <Box
                sx={{
                  height: 320,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  border: "2px dashed #ccc",
                  borderRadius: 1,
                }}
              >
                <Typography variant="body1" color="text.secondary">
                  No inventory data available
                </Typography>
              </Box>
            )}
          </Paper>
        </Grid>

        {/* Top Products by Movement */}
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>
              Most Active Products
            </Typography>
            {mostActiveProducts.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={mostActiveProducts}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="sku" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="total_movement" fill="#1976d2" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <Box
                sx={{
                  height: 300,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  border: "2px dashed #ccc",
                  borderRadius: 1,
                }}
              >
                <Typography variant="body1" color="text.secondary">
                  No product movement data available
                </Typography>
              </Box>
            )}
          </Paper>
        </Grid>

        {/* Low Stock Alerts */}
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>
              Low Stock Alerts
            </Typography>
            <List>
              {data?.lowStockProducts?.slice(0, 6).map((product, index) => (
                <React.Fragment key={product.sku}>
                  <ListItem>
                    <ListItemText
                      primary={product.name}
                      secondary={`SKU: ${product.sku}`}
                    />
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                      <Typography variant="body2">
                        {product.current_stock}/{product.low_stock_threshold}
                      </Typography>
                      <Chip
                        label={product.severity}
                        color={
                          product.severity === "critical"
                            ? "error"
                            : product.severity === "high"
                            ? "warning"
                            : "default"
                        }
                        size="small"
                      />
                    </Box>
                  </ListItem>
                  {index < data.lowStockProducts.slice(0, 6).length - 1 && (
                    <Divider />
                  )}
                </React.Fragment>
              ))}
              {(!data?.lowStockProducts ||
                data.lowStockProducts.length === 0) && (
                <ListItem>
                  <ListItemText
                    primary="No low stock alerts"
                    secondary="All products are above threshold"
                  />
                </ListItem>
              )}
            </List>
          </Paper>
        </Grid>

        {/* Recent Transactions */}
        <Grid item xs={12}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>
              Recent Transactions
            </Typography>
            <List>
              {data?.recentTransactions
                ?.slice(0, 8)
                .map((transaction, index) => (
                  <React.Fragment key={transaction.id}>
                    <ListItem
                      sx={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        py: 1.5,
                        px: 0,
                      }}
                    >
                      <ListItemText
                        primary={`${transaction.product_name} (${transaction.product_sku})`}
                        secondary={`${format(
                          new Date(transaction.created_at),
                          "MMM dd, yyyy HH:mm"
                        )} - ${transaction.created_by_username || "Unknown"}`}
                        sx={{
                          flex: 1,
                          minWidth: 0,
                          mr: 2,
                        }}
                      />
                      <Box
                        sx={{
                          display: "flex",
                          alignItems: "center",
                          gap: 1,
                          flexShrink: 0,
                          minWidth: "fit-content",
                        }}
                      >
                        <Chip
                          label={`${transaction.type?.toUpperCase() || "N/A"} ${
                            transaction.quantity || 0
                          }`}
                          color={
                            transaction.type === "in" ? "success" : "error"
                          }
                          size="small"
                          sx={{
                            fontWeight: "bold",
                            fontSize: "0.75rem",
                            height: "24px",
                          }}
                        />
                      </Box>
                    </ListItem>
                    {index < data.recentTransactions.slice(0, 8).length - 1 && (
                      <Divider />
                    )}
                  </React.Fragment>
                ))}
            </List>
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
};

export default Dashboard;
