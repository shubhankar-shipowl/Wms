import React from "react";
import {
  Box,
  Typography,
  Card,
  CardContent,
  Grid,
  Chip,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Divider,
  Alert,
} from "@mui/material";
import {
  ArrowBack,
  Edit,
  QrCode,
  CurrencyRupee,
  Inventory,
  Warning,
  TrendingUp,
  TrendingDown,
} from "@mui/icons-material";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "react-query";
import axios from "axios";
import { format } from "date-fns";
import LoadingSpinner from "../components/Common/LoadingSpinner";
import { useAuth } from "../contexts/AuthContext";

const ProductDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isAdmin, isManager } = useAuth();

  // Fetch product details
  const {
    data: productData,
    isLoading,
    error,
  } = useQuery(
    ["product", id],
    () => axios.get(`/api/products/${id}`).then((res) => res.data),
    {
      enabled: !!id,
    }
  );

  // Fetch product transactions
  const { data: transactionsData } = useQuery(
    ["product-transactions", id],
    () =>
      axios
        .get(`/api/transactions?product_id=${id}&limit=10`)
        .then((res) => res.data),
    {
      enabled: !!id,
    }
  );

  if (isLoading) {
    return <LoadingSpinner message="Loading product details..." />;
  }

  if (error) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">
          {error.response?.data?.message || "Failed to load product details"}
        </Alert>
        <Button
          startIcon={<ArrowBack />}
          onClick={() => navigate("/products")}
          sx={{ mt: 2 }}
        >
          Back to Products
        </Button>
      </Box>
    );
  }

  const product = productData?.data;
  const transactions = transactionsData?.data?.transactions || [];

  if (!product) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="warning">Product not found</Alert>
        <Button
          startIcon={<ArrowBack />}
          onClick={() => navigate("/products")}
          sx={{ mt: 2 }}
        >
          Back to Products
        </Button>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      {/* Header */}
      <Box sx={{ display: "flex", alignItems: "center", mb: 3 }}>
        <Button
          startIcon={<ArrowBack />}
          onClick={() => navigate("/products")}
          sx={{ mr: 2 }}
        >
          Back to Products
        </Button>
        <Typography variant="h4" component="h1">
          {product.name}
        </Typography>
        {product.is_low_stock && (
          <Chip
            icon={<Warning />}
            label="Low Stock"
            color="error"
            sx={{ ml: 2 }}
          />
        )}
      </Box>

      <Grid container spacing={3}>
        {/* Product Information */}
        <Grid item xs={12} md={8}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Product Information
              </Typography>
              <Divider sx={{ mb: 2 }} />

              <Grid container spacing={2}>
                <Grid item xs={12} sm={6}>
                  <Typography variant="subtitle2" color="text.secondary">
                    SKU
                  </Typography>
                  <Typography variant="body1" gutterBottom>
                    {product.sku}
                  </Typography>
                </Grid>

                {isAdmin && (
                  <Grid item xs={12} sm={6}>
                    <Typography variant="subtitle2" color="text.secondary">
                      Price
                    </Typography>
                    <Typography variant="h6" color="primary" gutterBottom>
                      ₹{product.price}
                    </Typography>
                  </Grid>
                )}

                <Grid item xs={12} sm={6}>
                  <Typography variant="subtitle2" color="text.secondary">
                    Product Type
                  </Typography>
                  <Typography variant="body1" gutterBottom>
                    {product.product_type === "domestic"
                      ? "Domestic"
                      : "International"}
                  </Typography>
                </Grid>

                <Grid item xs={12} sm={6}>
                  <Typography variant="subtitle2" color="text.secondary">
                    HSN Code
                  </Typography>
                  <Typography variant="body1" gutterBottom>
                    {product.hsn_code || "Not specified"}
                  </Typography>
                </Grid>

                <Grid item xs={12} sm={6}>
                  <Typography variant="subtitle2" color="text.secondary">
                    GST Rate
                  </Typography>
                  <Typography variant="body1" gutterBottom>
                    {product.gst_rate}%
                  </Typography>
                </Grid>

                <Grid item xs={12} sm={6}>
                  <Typography variant="subtitle2" color="text.secondary">
                    Low Stock Threshold
                  </Typography>
                  <Typography variant="body1" gutterBottom>
                    {product.low_stock_threshold} units
                  </Typography>
                </Grid>

                <Grid item xs={12} sm={6}>
                  <Typography variant="subtitle2" color="text.secondary">
                    Created Date
                  </Typography>
                  <Typography variant="body1" gutterBottom>
                    {format(new Date(product.created_at), "MMM dd, yyyy")}
                  </Typography>
                </Grid>

                <Grid item xs={12} sm={6}>
                  <Typography variant="subtitle2" color="text.secondary">
                    Last Updated
                  </Typography>
                  <Typography variant="body1" gutterBottom>
                    {format(new Date(product.updated_at), "MMM dd, yyyy")}
                  </Typography>
                </Grid>
              </Grid>
            </CardContent>
          </Card>
        </Grid>

        {/* Stock & Barcode Summary */}
        <Grid item xs={12} md={4}>
          <Card sx={{ mb: 3 }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Stock Summary
              </Typography>
              <Divider sx={{ mb: 2 }} />

              <Box sx={{ display: "flex", alignItems: "center", mb: 2 }}>
                <Inventory sx={{ mr: 1, color: "primary.main" }} />
                <Box>
                  <Typography variant="h4" color="primary">
                    {product.total_stock || 0}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Current Stock
                  </Typography>
                </Box>
              </Box>

              <Box sx={{ display: "flex", alignItems: "center", mb: 2 }}>
                <QrCode sx={{ mr: 1, color: "secondary.main" }} />
                <Box>
                  <Typography variant="h4" color="secondary">
                    {product.barcode_count || 0}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Barcodes
                  </Typography>
                </Box>
              </Box>

              {isAdmin && (
                <Box sx={{ display: "flex", alignItems: "center" }}>
                  <CurrencyRupee sx={{ mr: 1, color: "success.main" }} />
                  <Box>
                    <Typography variant="h4" color="success.main">
                      {(
                        (product.total_stock || 0) * product.price
                      ).toLocaleString()}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Stock Value
                    </Typography>
                  </Box>
                </Box>
              )}
            </CardContent>
          </Card>

          {/* Action Buttons */}
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Actions
              </Typography>
              <Divider sx={{ mb: 2 }} />

              <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                <Button
                  variant="contained"
                  startIcon={<Edit />}
                  onClick={() => navigate("/products")}
                  fullWidth
                >
                  Edit Product
                </Button>
                <Button
                  variant="outlined"
                  startIcon={<QrCode />}
                  onClick={() => navigate("/barcodes")}
                  fullWidth
                >
                  Manage Barcodes
                </Button>
              </Box>
            </CardContent>
          </Card>
        </Grid>

        {/* Recent Transactions */}
        <Grid item xs={12}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Recent Transactions
              </Typography>
              <Divider sx={{ mb: 2 }} />

              {transactions.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  No transactions found for this product.
                </Typography>
              ) : (
                <TableContainer component={Paper} variant="outlined">
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Date</TableCell>
                        <TableCell>Type</TableCell>
                        <TableCell align="right">Quantity</TableCell>
                        <TableCell>Reference</TableCell>
                        <TableCell>Created By</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {transactions.map((transaction) => (
                        <TableRow key={transaction.id}>
                          <TableCell>
                            {format(
                              new Date(transaction.created_at),
                              "MMM dd, yyyy HH:mm"
                            )}
                          </TableCell>
                          <TableCell>
                            <Chip
                              label={transaction.transaction_type}
                              color={
                                transaction.transaction_type === "IN"
                                  ? "success"
                                  : "error"
                              }
                              size="small"
                              icon={
                                transaction.transaction_type === "IN" ? (
                                  <TrendingUp />
                                ) : (
                                  <TrendingDown />
                                )
                              }
                            />
                          </TableCell>
                          <TableCell align="right">
                            {transaction.quantity}
                          </TableCell>
                          <TableCell>{transaction.reference_number}</TableCell>
                          <TableCell>{transaction.created_by}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
};

export default ProductDetail;
