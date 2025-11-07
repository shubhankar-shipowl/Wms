import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Button,
  TextField,
  Grid,
  Card,
  CardContent,
  CardActions,
  Chip,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  FormControl,
  InputLabel,
  OutlinedInput,
  InputAdornment,
  Select,
  MenuItem,
} from '@mui/material';
import {
  Add,
  Search,
  Edit,
  Delete,
  Visibility,
  Warning,
  Image as ImageIcon,
  ShoppingCart,
  ChevronLeft,
  ChevronRight,
  KeyboardArrowUp,
  KeyboardArrowDown,
} from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import { useNavigate } from 'react-router-dom';
import { useForm, Controller } from 'react-hook-form';
import axios from 'axios';
import toast from 'react-hot-toast';
import { useAuth } from '../contexts/AuthContext';
import LoadingSpinner from '../components/Common/LoadingSpinner';

// Image Slider Component
const ImageSlider = ({ images, productName }) => {
  const [currentImageIndex, setCurrentImageIndex] = React.useState(0);

  const getImageUrl = (image) => {
    if (!image) return null;

    // Handle both old format (string) and new format (object)
    if (typeof image === 'string') {
      // Old format: image is a filename string
      const fullUrl = `/api/products/images/${image}`;
      console.log(
        'ImageSlider: Constructing URL for string',
        image,
        '->',
        fullUrl,
      );
      return fullUrl;
    } else if (image && image.id) {
      // New format: image is an object with id
      const fullUrl = `/api/products/images/${image.id}`;
      console.log(
        'ImageSlider: Constructing URL for object',
        image,
        '->',
        fullUrl,
      );
      return fullUrl;
    }

    return null;
  };

  const nextImage = () => {
    setCurrentImageIndex((prev) => (prev + 1) % images.length);
  };

  const prevImage = () => {
    setCurrentImageIndex((prev) => (prev - 1 + images.length) % images.length);
  };

  // Debug logging
  console.log(
    'ImageSlider: Received images:',
    images,
    'for product:',
    productName,
  );

  if (!images || images.length === 0) {
    return (
      <Box
        sx={{
          height: 150,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#f5f5f5',
          flexDirection: 'column',
          gap: 1,
        }}
      >
        <ImageIcon sx={{ fontSize: 36, color: 'text.secondary' }} />
        <Typography variant="body2" color="text.secondary">
          No Image
        </Typography>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        height: 200,
        minHeight: 150,
        maxHeight: 250,
        position: 'relative',
        overflow: 'hidden',
        backgroundColor: '#f5f5f5',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <img
        src={getImageUrl(images[currentImageIndex])}
        alt={`${productName} - ${currentImageIndex + 1}`}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          objectPosition: 'center',
          transition: 'transform 0.3s ease',
          padding: '8px',
        }}
        onError={(e) => {
          console.log('Image load error:', e.target.src);
          // Try to load thumbnail as fallback
          const currentImage = images[currentImageIndex];
          if (currentImage && currentImage.id) {
            // New format: use thumbnail query parameter
            const thumbnailUrl = `/api/products/images/${currentImage.id}?type=thumbnail`;
            if (e.target.src !== thumbnailUrl) {
              e.target.src = thumbnailUrl;
            } else {
              e.target.style.display = 'none';
            }
          } else if (typeof currentImage === 'string') {
            // Old format: replace optimized- with thumb-
            const thumbnailPath = currentImage.replace('optimized-', 'thumb-');
            if (e.target.src !== `/uploads/products/${thumbnailPath}`) {
              e.target.src = `/uploads/products/${thumbnailPath}`;
            } else {
              e.target.style.display = 'none';
            }
          } else {
            e.target.style.display = 'none';
          }
        }}
      />

      {/* Navigation Arrows - Only show if more than 1 image */}
      {images.length > 1 && (
        <>
          <IconButton
            onClick={prevImage}
            sx={{
              position: 'absolute',
              left: 4,
              top: '50%',
              transform: 'translateY(-50%)',
              backgroundColor: 'rgba(0,0,0,0.6)',
              color: 'white',
              width: 28,
              height: 28,
              '&:hover': {
                backgroundColor: 'rgba(0,0,0,0.8)',
              },
              zIndex: 2,
            }}
            size="small"
          >
            <ChevronLeft fontSize="small" />
          </IconButton>
          <IconButton
            onClick={nextImage}
            sx={{
              position: 'absolute',
              right: 4,
              top: '50%',
              transform: 'translateY(-50%)',
              backgroundColor: 'rgba(0,0,0,0.6)',
              color: 'white',
              width: 28,
              height: 28,
              '&:hover': {
                backgroundColor: 'rgba(0,0,0,0.8)',
              },
              zIndex: 2,
            }}
            size="small"
          >
            <ChevronRight fontSize="small" />
          </IconButton>
        </>
      )}

      {/* Image Indicators */}
      {images.length > 1 && (
        <Box
          sx={{
            position: 'absolute',
            bottom: 8,
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'flex',
            gap: 0.5,
            zIndex: 2,
          }}
        >
          {images.map((_, index) => (
            <Box
              key={index}
              sx={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                backgroundColor:
                  index === currentImageIndex
                    ? 'white'
                    : 'rgba(255,255,255,0.5)',
                cursor: 'pointer',
                transition: 'background-color 0.3s ease',
              }}
              onClick={() => setCurrentImageIndex(index)}
            />
          ))}
        </Box>
      )}
    </Box>
  );
};

// Modern Product Card Component
const ProductCard = ({
  product,
  onEdit,
  onDelete,
  onView,
  canEdit,
  isAdmin,
}) => {
  return (
    <Card
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        transition: 'all 0.3s ease-in-out',
        '&:hover': {
          transform: 'translateY(-4px)',
          boxShadow: '0 8px 25px rgba(0,0,0,0.15)',
        },
        borderRadius: 2,
        overflow: 'hidden',
        width: '100%',
        minHeight: 370,
        maxHeight: 400,
      }}
    >
      {/* Product Image Slider */}
      <Box sx={{ position: 'relative' }}>
        <ImageSlider images={product.images} productName={product.name} />

        {/* Low Stock Badge */}
        {product.is_low_stock && (
          <Chip
            icon={<Warning />}
            label="Low Stock"
            color="error"
            size="small"
            sx={{
              position: 'absolute',
              top: 8,
              right: 8,
              fontWeight: 'bold',
              zIndex: 3,
            }}
          />
        )}
      </Box>

      <CardContent
        sx={{
          flexGrow: 1,
          p: 1.5,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          minHeight: 120,
        }}
      >
        <Box>
          {/* Product Name */}
          <Typography
            variant="h6"
            component="div"
            sx={{
              fontWeight: 600,
              mb: 0.5,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              color: 'text.primary',
              fontSize: '1rem',
            }}
          >
            {product.name}
          </Typography>

          {/* SKU */}
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ mb: 0.5, fontFamily: 'monospace', fontSize: '0.75rem' }}
          >
            SKU: {product.sku}
          </Typography>

          {/* Price */}
          <Typography
            variant="h6"
            color="primary"
            sx={{
              fontWeight: 'bold',
              mb: 1,
              display: 'flex',
              alignItems: 'center',
              gap: 0.5,
              fontSize: '1.1rem',
            }}
          >
            <ShoppingCart fontSize="small" />₹{product.price}
          </Typography>

          {/* Stock and Barcode Info */}
          <Box
            sx={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              mb: 0.5,
              flexWrap: 'wrap',
              gap: 0.5,
            }}
          >
            <Typography
              variant="body2"
              sx={{
                fontWeight: 500,
                color: product.total_stock > 0 ? 'success.main' : 'error.main',
                fontSize: '0.75rem',
              }}
            >
              Stock: {product.total_stock || 0}
            </Typography>
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ fontSize: '0.75rem' }}
            >
              Barcodes: {product.barcode_count || 0}
            </Typography>
          </Box>

          {/* Product Type */}
          {product.product_type && (
            <Chip
              label={
                product.product_type === 'domestic'
                  ? 'Domestic'
                  : 'International'
              }
              size="small"
              variant="outlined"
              sx={{ mb: 1, fontSize: '0.7rem', height: '20px' }}
            />
          )}
        </Box>
      </CardContent>

      {/* Action Buttons */}
      <CardActions
        sx={{
          p: 1.5,
          pt: 0,
          justifyContent: 'space-between',
          backgroundColor: '#fafafa',
          minHeight: 48,
        }}
      >
        <IconButton
          size="small"
          onClick={() => onView(product.id)}
          title="View Details"
          sx={{
            color: 'primary.main',
            '&:hover': { backgroundColor: 'primary.light', color: 'white' },
          }}
        >
          <Visibility />
        </IconButton>

        {canEdit && (
          <IconButton
            size="small"
            onClick={() => onEdit(product)}
            title="Edit Product"
            sx={{
              color: 'warning.main',
              '&:hover': { backgroundColor: 'warning.light', color: 'white' },
            }}
          >
            <Edit />
          </IconButton>
        )}

        {isAdmin && (
          <IconButton
            size="small"
            onClick={() => onDelete(product)}
            title="Delete Product"
            sx={{
              color: 'error.main',
              '&:hover': { backgroundColor: 'error.light', color: 'white' },
            }}
          >
            <Delete />
          </IconButton>
        )}
      </CardActions>
    </Card>
  );
};

const ProductForm = ({ open, onClose, product = null, onSuccess }) => {
  const [selectedImages, setSelectedImages] = useState([]);
  const [imagePreview, setImagePreview] = useState([]);
  const [isCustomCategory, setIsCustomCategory] = useState(false);
  const [customCategoryValue, setCustomCategoryValue] = useState('');
  const [availableCategories, setAvailableCategories] = useState([]);

  // Fetch available categories from database
  useEffect(() => {
    const fetchCategories = async () => {
      try {
        const response = await axios.get('/api/products/categories');
        if (response.data.success) {
          setAvailableCategories(response.data.data || []);
        }
      } catch (error) {
        console.error('Error fetching categories:', error);
      }
    };

    if (open) {
      fetchCategories();
    }
  }, [open, onSuccess]);

  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors },
  } = useForm({
    defaultValues: product || {
      name: '',
      sku: '',
      price: '',
      category: '',
      unit: 'pcs',
      status: 'active',
      product_type: 'domestic',
      hsn_code: '',
      gst_rate: '',
    },
  });

  // Reset form when product changes
  useEffect(() => {
    if (product) {
      const category = product.category || '';
      const predefinedCategories = ['toys', 'kitchens', 'tools', 'home decor'];
      const isCustom = category && 
        !predefinedCategories.includes(category.toLowerCase()) &&
        !availableCategories.includes(category);
      
      setIsCustomCategory(isCustom);
      if (isCustom) {
        setCustomCategoryValue(category);
      }

      reset({
        name: product.name || '',
        sku: product.sku || '',
        price: product.price || '',
        category: isCustom ? 'custom' : category || '',
        unit: product.unit || 'pcs',
        status: product.status || 'active',
        product_type: product.product_type || 'domestic',
        hsn_code: product.hsn_code || '',
        gst_rate: product.gst_rate || '',
      });

      // Handle existing images
      if (product.images && Array.isArray(product.images)) {
        setImagePreview(
          product.images
            .map((img) => {
              // Handle both old format (string) and new format (object)
              if (typeof img === 'string') {
                return `/api/products/images/${img}`;
              } else if (img && img.id) {
                return `/api/products/images/${img.id}`;
              }
              return null;
            })
            .filter(Boolean),
        );
      } else {
        setImagePreview([]);
      }
      setSelectedImages([]);
    } else {
      // Reset to default values for new product
      setIsCustomCategory(false);
      setCustomCategoryValue('');
      reset({
        name: '',
        sku: '',
        price: '',
        category: '',
        unit: 'pcs',
        status: 'active',
        product_type: 'domestic',
        hsn_code: '',
        gst_rate: '',
      });
      setImagePreview([]);
      setSelectedImages([]);
    }
  }, [product, reset, availableCategories]);

  const handleImageChange = (event) => {
    const files = Array.from(event.target.files);

    // Validate file count
    if (files.length > 4) {
      toast.error('Maximum 4 images allowed');
      return;
    }

    // Validate file types and sizes
    const allowedTypes = [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/gif',
      'image/webp',
    ];
    const maxSize = 2 * 1024 * 1024; // 2MB

    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      // Check file type
      if (!allowedTypes.includes(file.type)) {
        toast.error(
          `Invalid file format: ${file.name}. Only JPEG, PNG, GIF, and WEBP images are allowed.`,
        );
        return;
      }

      // Check file size
      if (file.size > maxSize) {
        toast.error(
          `File too large: ${file.name}. Maximum size allowed is 2MB.`,
        );
        return;
      }
    }

    setSelectedImages(files);

    // Create preview URLs
    const previews = files.map((file) => URL.createObjectURL(file));
    setImagePreview(previews);
  };

  const removeImage = (index) => {
    const newImages = selectedImages.filter((_, i) => i !== index);
    const newPreviews = imagePreview.filter((_, i) => i !== index);

    setSelectedImages(newImages);
    setImagePreview(newPreviews);
  };

  const reorderImages = (fromIndex, toIndex) => {
    // Safety checks
    if (!selectedImages || !imagePreview || selectedImages.length === 0) {
      console.warn('Cannot reorder: no images selected');
      return;
    }

    if (
      fromIndex < 0 ||
      fromIndex >= selectedImages.length ||
      toIndex < 0 ||
      toIndex >= selectedImages.length
    ) {
      console.warn('Invalid indices for reordering');
      return;
    }

    const newImages = [...selectedImages];
    const newPreviews = [...imagePreview];

    // Remove the item from the original position
    const [movedImage] = newImages.splice(fromIndex, 1);
    const [movedPreview] = newPreviews.splice(fromIndex, 1);

    // Safety check for moved items
    if (!movedImage || !movedPreview) {
      console.warn('Cannot reorder: invalid image or preview');
      return;
    }

    // Insert it at the new position
    newImages.splice(toIndex, 0, movedImage);
    newPreviews.splice(toIndex, 0, movedPreview);

    console.log('Reordering images:', {
      fromIndex,
      toIndex,
      newOrder: newImages.map((img, idx) => ({
        index: idx,
        name: img?.name || 'Unknown',
      })),
    });

    setSelectedImages(newImages);
    setImagePreview(newPreviews);
  };

  const moveImageUp = (index) => {
    if (selectedImages && selectedImages.length > 0 && index > 0) {
      reorderImages(index, index - 1);
    }
  };

  const moveImageDown = (index) => {
    if (
      selectedImages &&
      selectedImages.length > 0 &&
      index < selectedImages.length - 1
    ) {
      reorderImages(index, index + 1);
    }
  };

  const mutation = useMutation(
    (data) => {
      if (product) {
        return axios.put(`/api/products/${product.id}`, data);
      } else {
        return axios.post('/api/products', data);
      }
    },
    {
      onSuccess: () => {
        toast.success(
          product
            ? 'Product updated successfully'
            : 'Product created successfully',
        );
        onSuccess();
        onClose();
        reset();
      },
      onError: (error) => {
        console.error('Product operation error:', error);
        const errorMessage =
          error.response?.data?.message || 'Operation failed';

        // Show more specific error messages
        if (
          errorMessage.includes('Invalid file format') ||
          errorMessage.includes('Unsupported image format')
        ) {
          toast.error(`Image Error: ${errorMessage}`);
        } else if (
          errorMessage.includes('too large') ||
          errorMessage.includes('LIMIT_FILE_SIZE')
        ) {
          toast.error(`File Size Error: ${errorMessage}`);
        } else if (
          errorMessage.includes('Too many files') ||
          errorMessage.includes('LIMIT_FILE_COUNT')
        ) {
          toast.error(`File Count Error: ${errorMessage}`);
        } else if (errorMessage.includes('Failed to process images')) {
          toast.error(`Image Processing Error: ${errorMessage}`);
        } else {
          toast.error(errorMessage);
        }
      },
    },
  );

  const onSubmit = (data) => {
    const formData = new FormData();

    // Handle category - if custom, use custom value
    const categoryValue = data.category === 'custom' ? customCategoryValue.trim() : data.category;
    if (categoryValue) {
      formData.append('category', categoryValue);
    }

    // Append other form fields
    Object.keys(data).forEach((key) => {
      if (key !== 'category' && data[key] !== undefined && data[key] !== '') {
        formData.append(key, data[key]);
      }
    });

    // Handle images for updates
    if (product && selectedImages.length === 0) {
      // If updating and no new images selected, send existing image IDs
      if (product.images && Array.isArray(product.images)) {
        const existingImageIds = product.images
          .map((img) => {
            if (typeof img === 'string') {
              // Old format: this shouldn't happen with new backend, but handle gracefully
              return null;
            } else if (img && img.id) {
              // New format: send the image ID
              return img.id;
            }
            return null;
          })
          .filter(Boolean);

        // Send existing image IDs as JSON string
        if (existingImageIds.length > 0) {
          formData.append('images', JSON.stringify(existingImageIds));
        }
      }
    } else if (selectedImages.length > 0) {
      // If new images are selected, send them
      selectedImages.forEach((image, index) => {
        formData.append('images', image);
      });
    }

    // Debug logging
    console.log('Submitting form with images:', selectedImages.length);
    console.log('Product images:', product?.images);
    console.log(
      'Selected images:',
      selectedImages.map((img, idx) => ({
        index: idx,
        name: img?.name || 'Unknown',
      })),
    );

    mutation.mutate(formData);
  };

  // Get all categories (predefined + from database)
  const getAllCategories = () => {
    const predefined = [
      { value: 'toys', label: 'Toys' },
      { value: 'kitchens', label: 'Kitchens' },
      { value: 'tools', label: 'Tools' },
      { value: 'home decor', label: 'Home Decor' },
    ];

    // Get custom categories from database that aren't in predefined list
    const customCategories = availableCategories
      .filter((cat) => {
        const lowerCat = cat.toLowerCase();
        return !['toys', 'kitchens', 'tools', 'home decor'].includes(lowerCat);
      })
      .map((cat) => ({ value: cat, label: cat }));

    return [...predefined, ...customCategories];
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <form onSubmit={handleSubmit(onSubmit)}>
        <DialogTitle>
          {product ? 'Edit Product' : 'Add New Product'}
        </DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Product Name"
                {...register('name', { required: 'Product name is required' })}
                error={!!errors.name}
                helperText={errors.name?.message}
              />
            </Grid>

            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="SKU"
                {...register('sku', { required: 'SKU is required' })}
                error={!!errors.sku}
                helperText={errors.sku?.message}
              />
            </Grid>

            <Grid item xs={12} sm={6}>
              <FormControl fullWidth>
                <InputLabel>Price</InputLabel>
                <OutlinedInput
                  startAdornment={
                    <InputAdornment position="start">₹</InputAdornment>
                  }
                  label="Price"
                  type="number"
                  step="0.01"
                  {...register('price', {
                    required: 'Price is required',
                    min: { value: 0, message: 'Price must be positive' },
                  })}
                  error={!!errors.price}
                />
              </FormControl>
              {errors.price && (
                <Typography variant="caption" color="error" sx={{ ml: 2 }}>
                  {errors.price.message}
                </Typography>
              )}
            </Grid>

            <Grid item xs={12} sm={6}>
              <FormControl fullWidth>
                <InputLabel>Category</InputLabel>
                <Controller
                  name="category"
                  control={control}
                  render={({ field }) => (
                    <Select
                      {...field}
                      label="Category"
                      onChange={(e) => {
                        const value = e.target.value;
                        field.onChange(value);
                        setIsCustomCategory(value === 'custom');
                        if (value !== 'custom') {
                          setCustomCategoryValue('');
                        }
                      }}
                    >
                      {getAllCategories().map((cat) => (
                        <MenuItem key={cat.value} value={cat.value}>
                          {cat.label}
                        </MenuItem>
                      ))}
                      <MenuItem value="custom">+ Add New Category</MenuItem>
                    </Select>
                  )}
                />
              </FormControl>
              {isCustomCategory && (
                <TextField
                  fullWidth
                  label="Custom Category"
                  value={customCategoryValue}
                  onChange={(e) => {
                    setCustomCategoryValue(e.target.value);
                  }}
                  sx={{ mt: 2 }}
                  error={!!errors.category}
                  helperText={errors.category?.message || 'Enter your custom category name'}
                />
              )}
            </Grid>

            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Unit"
                {...register('unit')}
                error={!!errors.unit}
                helperText={errors.unit?.message}
              />
            </Grid>

            <Grid item xs={12} sm={6}>
              <FormControl fullWidth>
                <InputLabel>Status</InputLabel>
                <Select
                  label="Status"
                  {...register('status')}
                  error={!!errors.status}
                  defaultValue="active"
                >
                  <MenuItem value="active">Active</MenuItem>
                  <MenuItem value="inactive">Inactive</MenuItem>
                  <MenuItem value="discontinued">Discontinued</MenuItem>
                </Select>
              </FormControl>
              {errors.status && (
                <Typography variant="caption" color="error" sx={{ ml: 2 }}>
                  {errors.status.message}
                </Typography>
              )}
            </Grid>

            <Grid item xs={12} sm={6}>
              <FormControl fullWidth>
                <InputLabel>Product Type</InputLabel>
                <Select
                  label="Product Type"
                  {...register('product_type')}
                  defaultValue="domestic"
                >
                  <MenuItem value="domestic">Domestic</MenuItem>
                  <MenuItem value="international">International</MenuItem>
                </Select>
              </FormControl>
            </Grid>

            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="HSN Code"
                {...register('hsn_code', {
                  required: 'HSN code is required',
                  minLength: {
                    value: 4,
                    message: 'HSN code must be at least 4 characters',
                  },
                  maxLength: {
                    value: 20,
                    message: 'HSN code must not exceed 20 characters',
                  },
                })}
                error={!!errors.hsn_code}
                helperText={errors.hsn_code?.message}
                placeholder="e.g., 1234"
              />
            </Grid>

            <Grid item xs={12} sm={6}>
              <FormControl fullWidth>
                <InputLabel>GST Rate (%)</InputLabel>
                <OutlinedInput
                  label="GST Rate (%)"
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  {...register('gst_rate', {
                    required: 'GST rate is required',
                    min: { value: 0, message: 'GST rate must be at least 0%' },
                    max: {
                      value: 100,
                      message: 'GST rate must not exceed 100%',
                    },
                  })}
                  error={!!errors.gst_rate}
                />
              </FormControl>
              {errors.gst_rate && (
                <Typography variant="caption" color="error" sx={{ ml: 2 }}>
                  {errors.gst_rate.message}
                </Typography>
              )}
            </Grid>

            {/* Image Upload Section */}
            <Grid item xs={12}>
              <Typography variant="h6" gutterBottom>
                Product Images (Max 4)
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Supported formats: JPEG, PNG, GIF, WEBP • Maximum size: 2MB per
                file
              </Typography>
              <input
                type="file"
                multiple
                accept="image/jpeg,image/jpg,image/png,image/gif,image/webp"
                onChange={handleImageChange}
                style={{ marginBottom: '16px' }}
              />
            </Grid>

            {imagePreview.length > 0 && (
              <Grid item xs={12}>
                <Typography variant="subtitle2" gutterBottom>
                  Image Preview (Click arrows to reorder):
                </Typography>
                <Grid container spacing={2}>
                  {imagePreview.map((preview, index) => (
                    <Grid item xs={12} sm={6} md={3} key={index}>
                      <Box
                        sx={{
                          position: 'relative',
                          border: '2px solid #e0e0e0',
                          borderRadius: '8px',
                          padding: '8px',
                          backgroundColor: '#f9f9f9',
                          '&:hover': {
                            borderColor: 'primary.main',
                          },
                        }}
                      >
                        {/* Position indicator */}
                        <Box
                          sx={{
                            position: 'absolute',
                            top: 4,
                            left: 4,
                            backgroundColor: 'primary.main',
                            color: 'white',
                            borderRadius: '50%',
                            width: 24,
                            height: 24,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '12px',
                            fontWeight: 'bold',
                            zIndex: 2,
                          }}
                        >
                          {index + 1}
                        </Box>

                        <img
                          src={preview}
                          alt={`Preview ${index + 1}`}
                          style={{
                            width: '100%',
                            height: '120px',
                            objectFit: 'contain',
                            borderRadius: '4px',
                          }}
                        />

                        {/* Control buttons */}
                        <Box
                          sx={{
                            position: 'absolute',
                            top: 4,
                            right: 4,
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 0.5,
                          }}
                        >
                          {/* Move up button */}
                          {index > 0 && (
                            <IconButton
                              size="small"
                              onClick={() => moveImageUp(index)}
                              sx={{
                                backgroundColor: 'rgba(255,255,255,0.9)',
                                color: 'primary.main',
                                width: 24,
                                height: 24,
                                '&:hover': {
                                  backgroundColor: 'primary.main',
                                  color: 'white',
                                },
                              }}
                            >
                              <KeyboardArrowUp fontSize="small" />
                            </IconButton>
                          )}

                          {/* Move down button */}
                          {index < imagePreview.length - 1 && (
                            <IconButton
                              size="small"
                              onClick={() => moveImageDown(index)}
                              sx={{
                                backgroundColor: 'rgba(255,255,255,0.9)',
                                color: 'primary.main',
                                width: 24,
                                height: 24,
                                '&:hover': {
                                  backgroundColor: 'primary.main',
                                  color: 'white',
                                },
                              }}
                            >
                              <KeyboardArrowDown fontSize="small" />
                            </IconButton>
                          )}

                          {/* Remove button */}
                          <IconButton
                            size="small"
                            onClick={() => removeImage(index)}
                            sx={{
                              backgroundColor: 'rgba(255,255,255,0.9)',
                              color: 'error.main',
                              width: 24,
                              height: 24,
                              '&:hover': {
                                backgroundColor: 'error.main',
                                color: 'white',
                              },
                            }}
                          >
                            <Delete fontSize="small" />
                          </IconButton>
                        </Box>
                      </Box>
                    </Grid>
                  ))}
                </Grid>
              </Grid>
            )}
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            type="submit"
            variant="contained"
            disabled={mutation.isLoading}
          >
            {mutation.isLoading ? 'Saving...' : product ? 'Update' : 'Create'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
};

const Products = () => {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [stockFilter, setStockFilter] = useState('high_to_low');
  const [skuFilter, setSkuFilter] = useState('asc');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { canEdit, isAdmin } = useAuth();

  // Fetch all available categories for the filter dropdown
  const { data: categoriesData } = useQuery(
    'products-categories',
    () =>
      axios.get('/api/products/categories').then((res) => res.data),
    {
      staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    },
  );

  const { data: productsData, isLoading } = useQuery(
    ['products', search, categoryFilter, stockFilter, skuFilter],
    () => {
      const sortOrder = stockFilter === 'high_to_low' ? 'DESC' : 'ASC';
      const skuSortOrder = skuFilter === 'asc' ? 'ASC' : 'DESC';

      return axios
        .get('/api/products', {
          params: {
            search,
            category: categoryFilter || undefined,
            // Fetch a larger page size to avoid missing cards when scrolling
            limit: 1000,
            sortBy: skuFilter === 'none' ? 'total_stock' : 'sku',
            sortOrder: skuFilter === 'none' ? sortOrder : skuSortOrder,
          },
        })
        .then((res) => res.data);
    },
    {
      keepPreviousData: true,
    },
  );

  const deleteMutation = useMutation(
    (id) => axios.delete(`/api/products/${id}`),
    {
      onSuccess: (response) => {
        const message = response.data.message || 'Product deleted successfully';
        toast.success(message);
        // Invalidate all product-related queries to refresh dropdowns everywhere
        queryClient.invalidateQueries('products');
        queryClient.invalidateQueries('products-filter');
        queryClient.invalidateQueries('barcodes');
      },
      onError: (error) => {
        toast.error(error.response?.data?.message || 'Delete failed');
      },
    },
  );

  const handleEdit = (product) => {
    setSelectedProduct(product);
    setDialogOpen(true);
  };

  const handleDelete = (product) => {
    const confirmMessage = `Are you sure you want to delete "${product.name}"?\n\nThis will also delete:\n• All associated barcodes\n• All stock transactions\n• All current stock records\n\nThis action cannot be undone.`;

    if (window.confirm(confirmMessage)) {
      deleteMutation.mutate(product.id);
    }
  };

  const handleView = (productId) => {
    navigate(`/products/${productId}`);
  };

  const handleDialogClose = () => {
    setDialogOpen(false);
    setSelectedProduct(null);
  };

  const handleDialogSuccess = () => {
    // Invalidate all product-related queries to refresh dropdowns everywhere
    queryClient.invalidateQueries('products');
    queryClient.invalidateQueries('products-filter');
    queryClient.invalidateQueries('products-categories'); // Refresh categories list
    queryClient.invalidateQueries('barcodes');
  };

  if (isLoading) {
    return <LoadingSpinner message="Loading products..." />;
  }

  const products = productsData?.data?.products || [];

  return (
    <Box>
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          mb: 4,
          flexWrap: 'wrap',
          gap: 2,
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
            Products
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Manage your inventory products
          </Typography>
        </Box>
        {canEdit && (
          <Button
            variant="contained"
            startIcon={<Add />}
            onClick={() => setDialogOpen(true)}
            sx={{
              borderRadius: 2,
              px: 3,
              py: 1,
              fontWeight: 600,
              textTransform: 'none',
              boxShadow: '0 4px 12px rgba(25, 118, 210, 0.3)',
              '&:hover': {
                boxShadow: '0 6px 16px rgba(25, 118, 210, 0.4)',
                transform: 'translateY(-1px)',
              },
            }}
          >
            Add Product
          </Button>
        )}
      </Box>

      {/* Search and Filter */}
      <Box sx={{ mb: 4 }}>
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} md={8}>
            <TextField
              fullWidth
              placeholder="Search products by name or SKU..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <Search color="action" />
                  </InputAdornment>
                ),
              }}
              sx={{
                '& .MuiOutlinedInput-root': {
                  borderRadius: 2,
                  backgroundColor: 'background.paper',
                  '&:hover': {
                    '& .MuiOutlinedInput-notchedOutline': {
                      borderColor: 'primary.main',
                    },
                  },
                  '&.Mui-focused': {
                    '& .MuiOutlinedInput-notchedOutline': {
                      borderWidth: 2,
                    },
                  },
                },
              }}
            />
          </Grid>
          <Grid item xs={12} md={2}>
            <FormControl fullWidth>
              <InputLabel>Sort by Stock</InputLabel>
              <Select
                value={stockFilter}
                onChange={(e) => setStockFilter(e.target.value)}
                label="Sort by Stock"
                sx={{
                  '& .MuiOutlinedInput-root': {
                    borderRadius: 2,
                    backgroundColor: 'background.paper',
                  },
                }}
              >
                <MenuItem value="high_to_low">High to Low Stock</MenuItem>
                <MenuItem value="low_to_high">Low to High Stock</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={2}>
            <FormControl fullWidth>
              <InputLabel>Sort by SKU</InputLabel>
              <Select
                value={skuFilter}
                onChange={(e) => setSkuFilter(e.target.value)}
                label="Sort by SKU"
                sx={{
                  '& .MuiOutlinedInput-root': {
                    borderRadius: 2,
                    backgroundColor: 'background.paper',
                  },
                }}
              >
                <MenuItem value="none">No SKU Sort</MenuItem>
                <MenuItem value="asc">SKU A-Z</MenuItem>
                <MenuItem value="desc">SKU Z-A</MenuItem>
              </Select>
            </FormControl>
          </Grid>
        </Grid>
        <Grid container spacing={2} alignItems="center" sx={{ mt: 1 }}>
          <Grid item xs={12} sm={6} md={3}>
            <FormControl fullWidth>
              <InputLabel>Filter by Category</InputLabel>
              <Select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                label="Filter by Category"
                sx={{
                  '& .MuiOutlinedInput-root': {
                    borderRadius: 2,
                    backgroundColor: 'background.paper',
                  },
                }}
              >
                <MenuItem value="">All Categories</MenuItem>
                {categoriesData?.data?.map((cat) => (
                  <MenuItem key={cat} value={cat}>
                    {cat}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
        </Grid>
      </Box>

      {/* Products Grid */}
      <Grid
        container
        spacing={3}
        sx={{
          '& .MuiGrid-item': {
            display: 'flex',
          },
        }}
      >
        {products.map((product) => (
          <Grid item xs={12} sm={6} md={4} lg={3} xl={2.4} key={product.id}>
            <ProductCard
              product={product}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onView={handleView}
              canEdit={canEdit}
              isAdmin={isAdmin}
            />
          </Grid>
        ))}
      </Grid>

      {products.length === 0 && (
        <Box sx={{ textAlign: 'center', py: 8 }}>
          <Typography variant="h6" color="text.secondary">
            {search || categoryFilter
              ? 'No products found matching your filters'
              : 'No products available'}
          </Typography>
          {canEdit && !search && !categoryFilter && (
            <Button
              variant="contained"
              startIcon={<Add />}
              onClick={() => setDialogOpen(true)}
              sx={{ mt: 2 }}
            >
              Add Your First Product
            </Button>
          )}
        </Box>
      )}

      {/* Product Form Dialog */}
      <ProductForm
        open={dialogOpen}
        onClose={handleDialogClose}
        product={selectedProduct}
        onSuccess={handleDialogSuccess}
      />
    </Box>
  );
};

export default Products;
