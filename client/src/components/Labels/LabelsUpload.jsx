import React, { useState } from 'react';
import { 
  Box, Button, Card, CardContent, Typography, 
  List, ListItem, ListItemText, ListItemAvatar, Avatar,
  IconButton, Alert, CircularProgress, LinearProgress
} from '@mui/material';
import { CloudUpload, PictureAsPdf, Delete, CheckCircle, Error as ErrorIcon } from '@mui/icons-material';
import { useDropzone } from 'react-dropzone';
import axios from 'axios';
import { toast } from 'react-hot-toast';

const LabelsUpload = ({ onUploadSuccess }) => {
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState('');

  const onDrop = (acceptedFiles) => {
    setFiles(acceptedFiles);
    setResults(null);
    setError('');
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/pdf': ['.pdf'] },
    multiple: true
  });

  const handleUpload = async () => {
    if (files.length === 0) return;

    setUploading(true);
    setError('');
    
    const formData = new FormData();
    files.forEach(file => {
      formData.append('files', file);
    });

    try {
      const response = await axios.post('/api/labels/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });

      if (response.data.success) {
        const { processed, failed } = response.data;
        
        setResults(response.data);
        onUploadSuccess && onUploadSuccess();
        setFiles([]); // Clear queue on success

        // Show generic success toast
        if (processed.length > 0) {
            toast.success(`Successfully processed ${processed.length} labels`);
        }

        // Show specific error toasts for duplicates or other failures
        if (failed && failed.length > 0) {
            // Group duplicate errors
            const duplicates = failed.filter(item => item.error.includes('Duplicate'));
            const otherErrors = failed.filter(item => !item.error.includes('Duplicate'));

            // Show single toast for duplicates
            if (duplicates.length > 0) {
                toast.error(
                    `Skipped ${duplicates.length} duplicate label(s).`,
                    { 
                        duration: 5000,
                        icon: '⚠️'
                    }
                );
            }

            // Show individual toasts for other errors
            otherErrors.forEach(item => {
                toast.error(`${item.file}: ${item.error}`, { duration: 4000 });
            });
        }
      }
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const removeFile = (index) => {
    const newFiles = [...files];
    newFiles.splice(index, 1);
    setFiles(newFiles);
  };

  return (
    <Card>
      <CardContent>
        <Typography variant="h6" gutterBottom>
          Upload Labels
        </Typography>
        
        <Box 
          {...getRootProps()} 
          sx={{ 
            border: '2px dashed #ccc', 
            borderRadius: 2, 
            p: 4, 
            textAlign: 'center',
            cursor: 'pointer',
            bgcolor: isDragActive ? '#f0f0f0' : 'background.paper',
            '&:hover': { bgcolor: '#f9f9f9' }
          }}
        >
          <input {...getInputProps()} />
          <CloudUpload sx={{ fontSize: 48, color: 'text.secondary', mb: 2 }} />
          <Typography variant="body1">
            {isDragActive ? "Drop PDF files here..." : "Drag & drop PDF files here, or click to select"}
          </Typography>
          <Typography variant="caption" color="textSecondary">
            Supports multi-page PDFs
          </Typography>
        </Box>

        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}

        {files.length > 0 && (
          <Box sx={{ mt: 3 }}>
            <Typography variant="subtitle2" gutterBottom>
              Selected Files ({files.length})
            </Typography>
            <List dense>
              {files.map((file, index) => (
                <ListItem
                  key={index}
                  secondaryAction={
                    !uploading && (
                      <IconButton edge="end" onClick={() => removeFile(index)}>
                        <Delete />
                      </IconButton>
                    )
                  }
                >
                  <ListItemAvatar>
                    <Avatar>
                      <PictureAsPdf />
                    </Avatar>
                  </ListItemAvatar>
                  <ListItemText 
                    primary={file.name} 
                    secondary={`${(file.size / 1024 / 1024).toFixed(2)} MB`} 
                  />
                </ListItem>
              ))}
            </List>
            
            {uploading && <LinearProgress sx={{ mt: 2 }} />}
            
            <Box sx={{ mt: 2, display: 'flex', justifyContent: 'flex-end' }}>
              <Button 
                variant="contained" 
                onClick={handleUpload}
                disabled={uploading}
                startIcon={uploading ? <CircularProgress size={20} /> : <CloudUpload />}
              >
                {uploading ? 'Processing...' : 'Upload & Extract'}
              </Button>
            </Box>
          </Box>
        )}
        
        {results && (
          <Alert severity="success" sx={{ mt: 2 }} icon={<CheckCircle />}>
            Successfully processed {results.processed} labels! 
            {results.failed?.length > 0 && ` (${results.failed.length} failed)`}
          </Alert>
        )}
      </CardContent>
    </Card>
  );
};

export default LabelsUpload;
