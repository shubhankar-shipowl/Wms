import React from 'react';
import { Box, Card, CardContent, Typography, Grid } from '@mui/material';
import { Inventory, LocalShipping, Store } from '@mui/icons-material';

const StatCard = ({ title, value, icon, color }) => (
  <Card sx={{ height: '100%' }}>
    <CardContent>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Typography color="textSecondary" variant="h6">
          {title}
        </Typography>
        <Box sx={{ 
          p: 1, 
          borderRadius: '50%', 
          bgcolor: (theme) => `${theme.palette[color].main}15`,
          color: `${color}.main`,
          display: 'flex' 
        }}>
          {icon}
        </Box>
      </Box>
      <Typography variant="h3" component="div">
        {value}
      </Typography>
    </CardContent>
  </Card>
);

const StatsDashboard = ({ stats }) => {
  if (!stats) return null;

  return (
    <Box sx={{ mb: 4 }}>
      <Grid container spacing={3}>
        <Grid item xs={12} md={4}>
          <StatCard
            title="Total Stores"
            value={stats.total_stores || 0}
            icon={<Store />}
            color="primary"
          />
        </Grid>
        <Grid item xs={12} md={4}>
          <StatCard
            title="Total Couriers"
            value={stats.total_couriers || 0}
            icon={<LocalShipping />}
            color="secondary"
          />
        </Grid>
        <Grid item xs={12} md={4}>
          <StatCard
            title="Total Labels"
            value={stats.total_products || 0}
            icon={<Inventory />}
            color="success"
          />
        </Grid>
      </Grid>
    </Box>
  );
};

export default StatsDashboard;
