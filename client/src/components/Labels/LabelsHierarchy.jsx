import React from 'react';
import { 
  Box, Accordion, AccordionSummary, AccordionDetails, 
  Typography, Chip, IconButton, Tooltip 
} from '@mui/material';
import { ExpandMore, LocalShipping, Store, Article, Download, Delete } from '@mui/icons-material';
import axios from 'axios';

const LabelItem = ({ label, onView, onDownload, onDelete }) => (
  <Box sx={{ 
    display: 'flex', 
    alignItems: 'center', 
    justifyContent: 'space-between',
    p: 1, 
    pl: 4, 
    borderBottom: '1px solid #eee',
    '&:hover': { bgcolor: '#f9f9f9' }
  }}>
    <Box sx={{ display: 'flex', alignItems: 'center' }}>
      <Article color="action" sx={{ mr: 2, fontSize: 20 }} />
      <Box>
        <Typography variant="body2" sx={{ fontWeight: 500 }}>
          {label.product_name}
        </Typography>
        <Typography variant="caption" color="textSecondary">
          {label.order_number && `Order: ${label.order_number} • `}
          {new Date(label.date).toLocaleDateString()} • {label.filename}
        </Typography>
      </Box>
    </Box>
    <Box>
      <Tooltip title="Delete">
        <IconButton size="small" onClick={() => onDelete(label.id)} color="error">
          <Delete fontSize="small" />
        </IconButton>
      </Tooltip>
    </Box>
  </Box>
);

const CourierGroup = ({ courier, storeName, onView, onDownload, onDelete }) => (
  <Accordion defaultExpanded={false} disableGutters elevation={0} sx={{ '&:before': { display: 'none' } }}>
    <AccordionSummary expandIcon={<ExpandMore />} sx={{ bgcolor: '#fafafa', borderBottom: '1px solid #eee' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', width: '100%' }}>
        <LocalShipping sx={{ mr: 2, color: 'text.secondary' }} />
        <Typography sx={{ flexGrow: 1 }}>{courier.courier_name}</Typography>
        <Chip 
          label={`${courier.products_count} products`} 
          size="small" 
          variant="outlined" 
          sx={{ mr: 2 }}
        />
        <IconButton 
          size="small" 
          onClick={(e) => {
            e.stopPropagation();
            onDownload('courier', courier.courier_name, storeName);
          }}
        >
          <Download fontSize="small" />
        </IconButton>
      </Box>
    </AccordionSummary>
    <AccordionDetails sx={{ p: 0 }}>
      {courier.products.map(product => (
        <LabelItem 
          key={product.id} 
          label={product} 
          onView={onView}
          onDownload={onDownload}
          onDelete={onDelete}
        />
      ))}
    </AccordionDetails>
  </Accordion>
);

const StoreGroup = ({ store, onView, onDownload, onDelete }) => (
  <Accordion defaultExpanded={true} sx={{ mb: 2 }}>
    <AccordionSummary expandIcon={<ExpandMore />} sx={{ bgcolor: '#e3f2fd' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', width: '100%' }}>
        <Store color="primary" sx={{ mr: 2 }} />
        <Typography variant="subtitle1" sx={{ flexGrow: 1, fontWeight: 'bold' }}>
          {store.store_name}
        </Typography>
        <Chip 
          label={`${store.total_products} products`} 
          color="primary" 
          size="small" 
          sx={{ mr: 2 }} 
        />
         <IconButton 
          size="small" 
          onClick={(e) => {
            e.stopPropagation();
            onDownload('store', store.store_name);
          }}
        >
          <Download />
        </IconButton>
      </Box>
    </AccordionSummary>
    <AccordionDetails sx={{ p: 0 }}>
      {store.couriers.map(courier => (
        <CourierGroup 
          key={courier.courier_name} 
          courier={courier}
          storeName={store.store_name}
          onView={onView}
          onDownload={onDownload}
          onDelete={onDelete}
        />
      ))}
    </AccordionDetails>
  </Accordion>
);

const LabelsHierarchy = ({ data, onView, onDownload, onDelete }) => {
  if (!data || data.length === 0) {
    return (
      <Box sx={{ p: 4, textAlign: 'center' }}>
        <Typography color="textSecondary">
          No labels found. Upload a PDF to get started.
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ mt: 2 }}>
      {data.map(store => (
        <StoreGroup 
          key={store.store_name} 
          store={store} 
          onView={onView}
          onDownload={onDownload}
          onDelete={onDelete}
        />
      ))}
    </Box>
  );
};

export default LabelsHierarchy;
