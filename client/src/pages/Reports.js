import React, { useState } from 'react';
import {
  Box,
  Typography,
  Grid,
  Card,
  CardContent,
  Button,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  LinearProgress,
  Tabs,
  Tab,
  Alert,
} from '@mui/material';
import {
  TrendingUp,
  TrendingDown,
  Inventory,
  CurrencyRupee,
  Warning,
  BarChart,
  PieChart,
  TableChart,
  Download,
  Refresh,
} from '@mui/icons-material';
import {
  LineChart,
  Line,
  BarChart as RechartsBarChart,
  Bar,
  PieChart as RechartsPieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { useQuery } from 'react-query';
import axios from 'axios';
import { format } from 'date-fns';
import LoadingSpinner from '../components/Common/LoadingSpinner';

const MetricCard = ({
  title,
  value,
  icon,
  color = 'primary',
  subtitle,
  trend,
}) => (
  <Card>
    <CardContent>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
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
          {trend && (
            <Box sx={{ display: 'flex', alignItems: 'center', mt: 1 }}>
              {trend > 0 ? (
                <TrendingUp color="success" fontSize="small" />
              ) : (
                <TrendingDown color="error" fontSize="small" />
              )}
              <Typography
                variant="body2"
                color={trend > 0 ? 'success.main' : 'error.main'}
                sx={{ ml: 0.5 }}
              >
                {Math.abs(trend)}%
              </Typography>
            </Box>
          )}
        </Box>
        <Box sx={{ color: `${color}.main` }}>{icon}</Box>
      </Box>
    </CardContent>
  </Card>
);

const Reports = () => {
  const [selectedPeriod, setSelectedPeriod] = useState('30');
  const [selectedTab, setSelectedTab] = useState(0);

  // Fetch reports data
  const {
    data: reportsData,
    isLoading,
    refetch,
  } = useQuery(
    ['reports', selectedPeriod],
    () =>
      axios
        .get(`/api/reports?period=${selectedPeriod}`)
        .then((res) => res.data),
    {
      refetchInterval: 30000, // Refresh every 30 seconds
    },
  );

  const { data: abcAnalysisData } = useQuery('abc-analysis', () =>
    axios.get('/api/reports/abc-analysis').then((res) => res.data),
  );

  const { data: stockMovementsData } = useQuery('stock-movements', () =>
    axios.get('/api/reports/stock-movements?period=30').then((res) => res.data),
  );

  const { data: topProductsData } = useQuery('top-products', () =>
    axios
      .get('/api/reports/top-products?period=30&limit=10')
      .then((res) => res.data),
  );

  const { data: lowStockData } = useQuery('low-stock', () =>
    axios.get('/api/reports/low-stock?limit=20').then((res) => res.data),
  );

  const { data: recentTransactionsData } = useQuery('recent-transactions', () =>
    axios
      .get('/api/reports/recent-transactions?limit=50')
      .then((res) => res.data),
  );

  if (isLoading) {
    return <LoadingSpinner message="Loading reports..." />;
  }

  const reports = reportsData?.data?.overview || {};
  const abcAnalysis = abcAnalysisData?.data || {};
  const stockMovements = stockMovementsData?.data?.dailyMovements || [];
  const topProducts = topProductsData?.data || [];
  const lowStockItems = lowStockData?.data || [];
  const recentTransactions = recentTransactionsData?.data?.transactions || [];

  // Prepare chart data - group by date
  const stockMovementData =
    stockMovements?.reduce((acc, item) => {
      const dateKey = format(new Date(item.date), 'MMM dd');
      const existing = acc.find((d) => d.date === dateKey);

      if (existing) {
        if (item.type === 'in') {
          existing.in = parseInt(item.total_quantity);
        } else if (item.type === 'out') {
          existing.out = parseInt(item.total_quantity);
        }
      } else {
        acc.push({
          date: dateKey,
          in: item.type === 'in' ? parseInt(item.total_quantity) : 0,
          out: item.type === 'out' ? parseInt(item.total_quantity) : 0,
        });
      }
      return acc;
    }, []) || [];

  const topProductsChartData = topProducts?.slice(0, 10) || [];
  const lowStockChartData = lowStockItems?.slice(0, 10) || [];

  // ABC Analysis data
  const abcChartData = [
    {
      category: 'A',
      count: abcAnalysis.summary?.A?.length || 0,
      value:
        abcAnalysis.summary?.A?.reduce(
          (sum, item) => sum + parseFloat(item.total_value || 0),
          0,
        ) || 0,
      percentage:
        abcAnalysis.summary?.A?.length > 0
          ? (abcAnalysis.summary.A.reduce(
              (sum, item) => sum + parseFloat(item.total_value || 0),
              0,
            ) /
              abcAnalysis.totalValue) *
            100
          : 0,
    },
    {
      category: 'B',
      count: abcAnalysis.summary?.B?.length || 0,
      value:
        abcAnalysis.summary?.B?.reduce(
          (sum, item) => sum + parseFloat(item.total_value || 0),
          0,
        ) || 0,
      percentage:
        abcAnalysis.summary?.B?.length > 0
          ? (abcAnalysis.summary.B.reduce(
              (sum, item) => sum + parseFloat(item.total_value || 0),
              0,
            ) /
              abcAnalysis.totalValue) *
            100
          : 0,
    },
    {
      category: 'C',
      count: abcAnalysis.summary?.C?.length || 0,
      value:
        abcAnalysis.summary?.C?.reduce(
          (sum, item) => sum + parseFloat(item.total_value || 0),
          0,
        ) || 0,
      percentage:
        abcAnalysis.summary?.C?.length > 0
          ? (abcAnalysis.summary.C.reduce(
              (sum, item) => sum + parseFloat(item.total_value || 0),
              0,
            ) /
              abcAnalysis.totalValue) *
            100
          : 0,
    },
  ];

  const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042'];

  const handleExport = async (type) => {
    try {
      let exportUrl = '';
      let filename = '';

      switch (type) {
        case 'transactions':
          exportUrl = '/api/transactions/export/csv';
          filename = `transactions_export_${
            new Date().toISOString().split('T')[0]
          }.csv`;
          break;
        case 'low-stock':
          // Export low stock items as CSV
          const lowStockCsvHeader = [
            'Product Name',
            'SKU',
            'Current Stock',
            'Low Stock Threshold',
            'Status',
          ].join(',');
          const lowStockCsvRows = lowStockItems.map((item) =>
            [
              `"${item.name || ''}"`,
              `"${item.sku || ''}"`,
              item.current_stock || 0,
              item.low_stock_threshold || 0,
              `"${
                item.current_stock <= item.low_stock_threshold
                  ? 'Low Stock'
                  : 'Normal'
              }"`,
            ].join(','),
          );
          const lowStockCsvContent = [
            lowStockCsvHeader,
            ...lowStockCsvRows,
          ].join('\n');

          const lowStockBlob = new Blob([lowStockCsvContent], {
            type: 'text/csv',
          });
          const lowStockUrl = window.URL.createObjectURL(lowStockBlob);
          const lowStockLink = document.createElement('a');
          lowStockLink.href = lowStockUrl;
          lowStockLink.download = `low_stock_items_${
            new Date().toISOString().split('T')[0]
          }.csv`;
          document.body.appendChild(lowStockLink);
          lowStockLink.click();
          lowStockLink.remove();
          window.URL.revokeObjectURL(lowStockUrl);
          return;
        case 'reports':
          // For general reports, we can export the current data as JSON
          const reportData = {
            overview: reports,
            recentTransactions: recentTransactions,
            lowStockItems: lowStockItems,
            topProducts: topProducts,
            stockMovements: stockMovements,
            abcAnalysis: abcAnalysis,
            exportDate: new Date().toISOString(),
            period: selectedPeriod,
          };

          const dataStr = JSON.stringify(reportData, null, 2);
          const dataBlob = new Blob([dataStr], { type: 'application/json' });
          const url = window.URL.createObjectURL(dataBlob);
          const link = document.createElement('a');
          link.href = url;
          link.download = `wms_report_${
            new Date().toISOString().split('T')[0]
          }.json`;
          document.body.appendChild(link);
          link.click();
          link.remove();
          window.URL.revokeObjectURL(url);
          return;
        default:
          console.log(`Export type ${type} not implemented yet`);
          return;
      }

      if (exportUrl) {
        const response = await axios.get(exportUrl, {
          responseType: 'blob',
        });

        const url = window.URL.createObjectURL(new Blob([response.data]));
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.URL.revokeObjectURL(url);
      }
    } catch (error) {
      console.error('Export failed:', error);
      // You could add a toast notification here
      alert('Export failed. Please try again.');
    }
  };

  const handleRefresh = () => {
    refetch();
  };

  return (
    <Box>
      {/* Header */}
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          mb: 3,
        }}
      >
        <Box>
          <Typography
            variant="h4"
            component="h1"
            sx={{
              fontWeight: 700,
              background: 'linear-gradient(45deg, #1976d2 30%, #42a5f5 90%)',
              backgroundClip: 'text',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              mb: 0.5,
            }}
          >
            Reports & Analytics
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Comprehensive insights into your warehouse operations
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 2 }}>
          <FormControl size="small" sx={{ minWidth: 120 }}>
            <InputLabel>Period</InputLabel>
            <Select
              value={selectedPeriod}
              onChange={(e) => setSelectedPeriod(e.target.value)}
              label="Period"
            >
              <MenuItem value="7">Last 7 days</MenuItem>
              <MenuItem value="30">Last 30 days</MenuItem>
              <MenuItem value="90">Last 90 days</MenuItem>
              <MenuItem value="365">Last year</MenuItem>
            </Select>
          </FormControl>
          <Button
            variant="outlined"
            startIcon={<Refresh />}
            onClick={handleRefresh}
          >
            Refresh
          </Button>
        </Box>
      </Box>

      {/* Key Metrics */}
      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} md={3}>
          <MetricCard
            title="Total Products"
            value={reports.totalProducts || 0}
            icon={<Inventory fontSize="large" />}
            color="primary"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <MetricCard
            title="Inventory Value"
            value={`₹${(reports.inventoryValue || 0).toLocaleString()}`}
            icon={<CurrencyRupee fontSize="large" />}
            color="success"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <MetricCard
            title="Low Stock Items"
            value={reports.lowStockProducts || 0}
            icon={<Warning fontSize="large" />}
            color="error"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <MetricCard
            title="Transactions"
            value={reports.recentTransactions || 0}
            icon={<TrendingUp fontSize="large" />}
            color="info"
            subtitle={`Last ${selectedPeriod} days`}
          />
        </Grid>
      </Grid>

      {/* Tabs */}
      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
        <Tabs
          value={selectedTab}
          onChange={(e, newValue) => setSelectedTab(newValue)}
        >
          <Tab label="Overview" icon={<BarChart />} />
          <Tab label="Inventory Analysis" icon={<Inventory />} />
          <Tab label="Transaction Reports" icon={<TableChart />} />
          <Tab label="ABC Analysis" icon={<PieChart />} />
        </Tabs>
      </Box>

      {/* Overview Tab */}
      {selectedTab === 0 && (
        <Grid container spacing={3}>
          <Grid item xs={12} lg={8}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Stock Movement Trends
                </Typography>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={stockMovementData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
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
              </CardContent>
            </Card>
          </Grid>

          <Grid item xs={12} lg={4}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Top Products by Activity
                </Typography>
                <ResponsiveContainer width="100%" height={300}>
                  <RechartsBarChart data={topProductsChartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="sku" />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="transaction_count" fill="#1976d2" />
                  </RechartsBarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}

      {/* Inventory Analysis Tab */}
      {selectedTab === 1 && (
        <Grid container spacing={3}>
          <Grid item xs={12} md={6}>
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
                  <Typography variant="h6">Low Stock Items</Typography>
                  <Button
                    variant="outlined"
                    startIcon={<Download />}
                    onClick={() => handleExport('low-stock')}
                    size="small"
                  >
                    Export
                  </Button>
                </Box>
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Product</TableCell>
                        <TableCell align="right">Current Stock</TableCell>
                        <TableCell align="right">Threshold</TableCell>
                        <TableCell align="center">Status</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {lowStockChartData.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell>{item.name}</TableCell>
                          <TableCell align="right">
                            {item.current_stock}
                          </TableCell>
                          <TableCell align="right">
                            {item.low_stock_threshold}
                          </TableCell>
                          <TableCell align="center">
                            <Chip
                              label="Low Stock"
                              color="error"
                              size="small"
                              icon={<Warning />}
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </CardContent>
            </Card>
          </Grid>

          <Grid item xs={12} md={6}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Inventory Health
                </Typography>
                <Box sx={{ mt: 2 }}>
                  <Box
                    sx={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      mb: 1,
                    }}
                  >
                    <Typography variant="body2">In Stock Items</Typography>
                    <Typography variant="body2">
                      {reports.inStockProducts || 0} /{' '}
                      {reports.totalProducts || 0}
                    </Typography>
                  </Box>
                  <LinearProgress
                    variant="determinate"
                    value={
                      ((reports.inStockProducts || 0) /
                        (reports.totalProducts || 1)) *
                      100
                    }
                    sx={{ mb: 2 }}
                  />
                  <Box
                    sx={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      mb: 1,
                    }}
                  >
                    <Typography variant="body2">Low Stock Items</Typography>
                    <Typography variant="body2">
                      {reports.lowStockProducts || 0}
                    </Typography>
                  </Box>
                  <LinearProgress
                    variant="determinate"
                    value={
                      ((reports.lowStockProducts || 0) /
                        (reports.totalProducts || 1)) *
                      100
                    }
                    color="error"
                  />
                </Box>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}

      {/* Transaction Reports Tab */}
      {selectedTab === 2 && (
        <Grid container spacing={3}>
          <Grid item xs={12}>
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
                  <Typography variant="h6">Recent Transactions</Typography>
                  <Button
                    variant="outlined"
                    startIcon={<Download />}
                    onClick={() => handleExport('transactions')}
                    size="small"
                  >
                    Export
                  </Button>
                </Box>
                <TableContainer>
                  <Table>
                    <TableHead>
                      <TableRow>
                        <TableCell>Date</TableCell>
                        <TableCell>Product</TableCell>
                        <TableCell>Type</TableCell>
                        <TableCell align="right">Quantity</TableCell>
                        <TableCell>Reference</TableCell>
                        <TableCell>User</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {recentTransactions?.map((transaction) => (
                        <TableRow key={transaction.id}>
                          <TableCell>
                            {format(
                              new Date(transaction.created_at),
                              'MMM dd, yyyy HH:mm',
                            )}
                          </TableCell>
                          <TableCell>{transaction.product_name}</TableCell>
                          <TableCell>
                            <Chip
                              label={transaction.type?.toUpperCase() || 'N/A'}
                              color={
                                transaction.type === 'in' ? 'success' : 'error'
                              }
                              size="small"
                            />
                          </TableCell>
                          <TableCell align="right">
                            {transaction.quantity}
                          </TableCell>
                          <TableCell>{transaction.reference_number}</TableCell>
                          <TableCell>
                            {transaction.created_by_username || 'N/A'}
                          </TableCell>
                        </TableRow>
                      )) || []}
                    </TableBody>
                  </Table>
                </TableContainer>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}

      {/* ABC Analysis Tab */}
      {selectedTab === 3 && (
        <Grid container spacing={3}>
          <Grid item xs={12} md={6}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  ABC Analysis
                </Typography>
                <ResponsiveContainer width="100%" height={300}>
                  <RechartsPieChart>
                    <Pie
                      data={abcChartData}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ category, percentage }) =>
                        `${category}: ${percentage}%`
                      }
                      outerRadius={80}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      {abcChartData.map((entry, index) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={COLORS[index % COLORS.length]}
                        />
                      ))}
                    </Pie>
                    <Tooltip />
                  </RechartsPieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </Grid>

          <Grid item xs={12} md={6}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  ABC Analysis Details
                </Typography>
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Category</TableCell>
                        <TableCell align="right">Count</TableCell>
                        <TableCell align="right">Value</TableCell>
                        <TableCell align="right">Percentage</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {abcChartData.map((item) => (
                        <TableRow key={item.category}>
                          <TableCell>
                            <Chip
                              label={`Category ${item.category}`}
                              color={
                                item.category === 'A'
                                  ? 'error'
                                  : item.category === 'B'
                                  ? 'warning'
                                  : 'default'
                              }
                              size="small"
                            />
                          </TableCell>
                          <TableCell align="right">{item.count}</TableCell>
                          <TableCell align="right">
                            ₹{item.value.toLocaleString()}
                          </TableCell>
                          <TableCell align="right">
                            {item.percentage}%
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}

      {/* No Data State */}
      {!reportsData && !abcAnalysisData && !stockMovementsData && (
        <Box sx={{ textAlign: 'center', py: 8 }}>
          <Alert severity="info" sx={{ maxWidth: 600, mx: 'auto' }}>
            <Typography variant="h6" gutterBottom>
              No Data Available
            </Typography>
            <Typography>
              Reports will be available once you have some inventory and
              transaction data. Start by adding products and performing some
              stock operations.
            </Typography>
          </Alert>
        </Box>
      )}
    </Box>
  );
};

export default Reports;
