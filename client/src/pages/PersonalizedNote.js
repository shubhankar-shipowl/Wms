import React, { useState, useRef, useEffect } from 'react';
import {
  Box, Typography, TextField, Button, Paper, Grid, Stack,
  FormControl, InputLabel, Select, MenuItem, IconButton,
  Divider, Chip
} from '@mui/material';
import { Download, Add, Delete, Favorite, CloudUpload, Close } from '@mui/icons-material';
import { useQuery } from 'react-query';
import axios from 'axios';
import jsPDF from 'jspdf';
import { toast } from 'react-hot-toast';

const NOTE_MESSAGES = {
  thankYou: 'for ordering from us!',
  packed: 'we packed it with LOVE just for you !'
};

// Pink Minimalist design colors
const THEME = {
  bg: '#FBF7F2',
  heartLight: '#C5DEF2',
  heartFill: '#5CB8F5',
  textDark: '#0D47A1',     // "Thank" only - darkest blue
  textMedium: '#1565C0',   // "Hi Name," and messages - medium blue
  textScript: '#3949AB',   // "you," - indigo/blue-purple
  storeBg: 'rgba(255,255,255,0.92)',
  storeText: '#1A1A1A',
  heartSmall: '#C0CAD8',   // tiny heart after "you," - light grey
};

// SVG Heart shape
const HeartSvg = ({ size = 80, color = THEME.heartLight, style = {} }) => (
  <svg
    viewBox="0 0 100 100"
    style={{
      position: 'absolute',
      width: size,
      height: size,
      pointerEvents: 'none',
      ...style,
    }}
  >
    <path
      d="M50 90C50 90 10 65 5 35C0 15 15 0 30 0C40 0 48 8 50 15C52 8 60 0 70 0C85 0 100 15 95 35C90 65 50 90 50 90Z"
      fill={color}
    />
  </svg>
);

const NoteCard = ({ name, storeName, storeLogo, messages, size }) => {
  const scale = size === 'print' ? 1 : 0.85;
  const isPreview = size !== 'print';

  return (
    <Box
      sx={{
        width: isPreview ? 280 : '3.5in',
        height: isPreview ? 340 : '4.5in',
        borderRadius: '10px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        bgcolor: THEME.bg,
        position: 'relative',
        overflow: 'hidden',
        boxSizing: 'border-box',
        pageBreakInside: 'avoid',
        boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
      }}
    >
      {/* Hearts container - absolutely positioned, clipped by parent overflow:hidden */}
      <Box
        sx={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          overflow: 'hidden',
          pointerEvents: 'none',
          zIndex: 0,
        }}
      >
        {/* Top-left heart */}
        <HeartSvg
          size={isPreview ? 100 : 120}
          style={{ top: isPreview ? -25 : -30, left: isPreview ? -22 : -28, transform: 'rotate(-15deg)' }}
        />
        {/* Top-right heart */}
        <HeartSvg
          size={isPreview ? 110 : 130}
          style={{ top: isPreview ? -20 : -24, right: isPreview ? -28 : -34, transform: 'rotate(15deg)' }}
        />
        {/* Bottom-left heart */}
        <HeartSvg
          size={isPreview ? 80 : 95}
          style={{ bottom: isPreview ? -18 : -22, left: isPreview ? -18 : -22, transform: 'rotate(10deg)' }}
        />
        {/* Bottom-right heart */}
        <HeartSvg
          size={isPreview ? 95 : 110}
          style={{ bottom: isPreview ? -22 : -26, right: isPreview ? -20 : -24, transform: 'rotate(-10deg)' }}
        />
        {/* Small solid blue heart */}
        <HeartSvg
          size={isPreview ? 22 : 26}
          color={THEME.heartFill}
          style={{ top: '22%', left: '8%' }}
        />
      </Box>

      {/* Store Logo or Store Name */}
      {storeLogo ? (
        <Box
          sx={{
            zIndex: 1,
            mt: isPreview ? '45px' : '0.4in',
            mb: 0,
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          <img
            src={storeLogo}
            alt="Store Logo"
            style={{
              maxHeight: isPreview ? 45 : 55,
              maxWidth: isPreview ? 140 : 170,
              objectFit: 'contain',
            }}
          />
        </Box>
      ) : (
        <Box
          sx={{
            bgcolor: THEME.storeBg,
            px: 2.5,
            py: 0.6,
            borderRadius: '4px',
            zIndex: 1,
            mt: isPreview ? '55px' : '0.5in',
            mb: 0,
            boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
          }}
        >
          <Typography
            sx={{
              fontWeight: 800,
              fontSize: 15 * scale,
              color: THEME.storeText,
              letterSpacing: 0.5,
              fontFamily: '"Segoe UI", Arial, sans-serif',
            }}
          >
            {storeName || 'Store Name'}
          </Typography>
        </Box>
      )}

      {/* Main Content */}
      <Box
        sx={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          textAlign: 'center',
          width: '100%',
          px: isPreview ? 2.5 : '0.3in',
          zIndex: 1,
        }}
      >
        {/* Hi Name, */}
        <Typography
          sx={{
            fontWeight: 700,
            fontSize: 22 * scale,
            color: THEME.textMedium,
            letterSpacing: 3,
            mb: 1,
            fontFamily: '"Segoe UI", Arial, sans-serif',
          }}
        >
          Hi {name || 'NAME'},
        </Typography>

        {/* Thank you, with heart */}
        <Box sx={{ mb: 2.5, display: 'flex', alignItems: 'baseline', justifyContent: 'center', flexWrap: 'wrap' }}>
          <Typography
            component="span"
            sx={{
              fontFamily: 'Georgia, "Times New Roman", serif',
              fontSize: 32 * scale,
              color: THEME.textDark,
              fontWeight: 400,
              lineHeight: 1.2,
            }}
          >
            Thank
          </Typography>
          <Typography
            component="span"
            sx={{
              fontFamily: '"Satisfy", "Dancing Script", cursive',
              fontSize: 30 * scale,
              color: THEME.textScript,
              ml: 0.5,
              lineHeight: 1.2,
              position: 'relative',
              top: '2px',
            }}
          >
            you,
          </Typography>
          <Favorite sx={{ color: THEME.heartSmall, fontSize: 15 * scale, ml: 0.5 }} />
        </Box>

        {/* for ordering from us! */}
        <Typography
          sx={{
            fontWeight: 700,
            fontSize: 15 * scale,
            color: THEME.textMedium,
            lineHeight: 1.7,
            mb: 2.5,
            fontFamily: '"Segoe UI", Arial, sans-serif',
          }}
        >
          {messages.thankYou}
        </Typography>

        {/* we packed it with LOVE just for you ! */}
        <Typography
          sx={{
            fontWeight: 700,
            fontSize: 15 * scale,
            color: THEME.textMedium,
            lineHeight: 1.7,
            fontFamily: '"Segoe UI", Arial, sans-serif',
          }}
        >
          {messages.packed}
        </Typography>
      </Box>

      {/* Support email at bottom */}
      <Typography
        sx={{
          fontSize: 9 * scale,
          color: '#999',
          zIndex: 1,
          mb: isPreview ? 1.5 : '0.15in',
          fontFamily: '"Segoe UI", Arial, sans-serif',
        }}
      >
        support@shopperskart.shop
      </Typography>
    </Box>
  );
};

const PersonalizedNote = () => {
  const [names, setNames] = useState([{ id: 1, value: '', store: '' }]);
  const [defaultStore, setDefaultStore] = useState('');
  const [selectedProduct, setSelectedProduct] = useState('all');
  const [storeLogos, setStoreLogos] = useState({});
  const [messages, setMessages] = useState({ ...NOTE_MESSAGES });
  const printRef = useRef();
  const logoInputRef = useRef();
  const [logoUploadStore, setLogoUploadStore] = useState('');

  // Load Satisfy font for script-style "you,"
  useEffect(() => {
    const link = document.createElement('link');
    link.href = 'https://fonts.googleapis.com/css2?family=Satisfy&display=swap';
    link.rel = 'stylesheet';
    document.head.appendChild(link);
    return () => {
      if (document.head.contains(link)) document.head.removeChild(link);
    };
  }, []);

  // Fetch all store logos from DB on mount
  useEffect(() => {
    const fetchLogos = async () => {
      try {
        const { data } = await axios.get('/api/labels/store-logos');
        if (!data.stores || data.stores.length === 0) return;
        const logos = {};
        await Promise.all(data.stores.map(async (storeName) => {
          try {
            const res = await axios.get(`/api/labels/store-logo/${encodeURIComponent(storeName)}`, { responseType: 'blob' });
            const dataUrl = await new Promise((resolve) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result);
              reader.readAsDataURL(res.data);
            });
            logos[storeName] = dataUrl;
          } catch (err) {
            // Skip failed logo
          }
        }));
        setStoreLogos(logos);
      } catch (err) {
        // No logos stored yet
      }
    };
    fetchLogos();
  }, []);

  const handleLogoUpload = async (e) => {
    const file = e.target.files[0];
    const storeName = logoUploadStore;
    if (!file || !storeName) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Please upload an image file (PNG, JPG, etc.)');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error('Logo must be under 2MB');
      return;
    }
    try {
      const formData = new FormData();
      formData.append('logo', file);
      formData.append('store_name', storeName);
      await axios.post('/api/labels/store-logo', formData);
      const dataUrl = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.readAsDataURL(file);
      });
      setStoreLogos(prev => ({ ...prev, [storeName]: dataUrl }));
      toast.success(`Logo uploaded for ${storeName}`);
    } catch (err) {
      toast.error('Failed to upload logo');
    }
    e.target.value = '';
    setLogoUploadStore('');
  };

  const removeLogo = async (storeName) => {
    try {
      await axios.delete(`/api/labels/store-logo/${encodeURIComponent(storeName)}`);
      setStoreLogos(prev => {
        const updated = { ...prev };
        delete updated[storeName];
        return updated;
      });
      toast.success(`Logo removed for ${storeName}`);
    } catch (err) {
      toast.error('Failed to remove logo');
    }
  };

  const { data: notesData, refetch } = useQuery(
    'personalized-notes-data',
    () => axios.get('/api/labels/personalized-notes-data').then(res => res.data),
    { staleTime: 0 }
  );

  const availableStores = notesData?.stores || [];
  const availableProducts = notesData?.products || [];

  const loadFromLabels = async (product) => {
    const raw = product !== undefined ? product : selectedProduct;
    const productFilter = raw === 'all' ? '' : raw;
    try {
      const params = productFilter ? `?product=${encodeURIComponent(productFilter)}` : '';
      const { data: freshData } = await axios.get(`/api/labels/personalized-notes-data${params}`);
      const entries = freshData?.entries || [];
      if (entries.length === 0) {
        toast.error(productFilter
          ? `No customer names found for product "${productFilter}". Try a different product or clear the filter.`
          : 'No customer names found in uploaded labels. Re-upload labels to extract names.');
        return;
      }
      setNames(entries.map((entry, i) => ({
        id: Date.now() + i,
        value: entry.customer_name.split(' ')[0],
        store: entry.store_name || ''
      })));
      toast.success(`Loaded ${entries.length} customer name(s)${productFilter ? ` for "${productFilter}"` : ' from labels'}`);
    } catch (error) {
      toast.error('Failed to load customer names');
    }
  };

  // Auto-load all customer names from labels on first page visit
  useEffect(() => {
    const autoLoad = async () => {
      try {
        const { data } = await axios.get('/api/labels/personalized-notes-data');
        const entries = data?.entries || [];
        if (entries.length > 0) {
          setNames(entries.map((entry, i) => ({
            id: Date.now() + i,
            value: entry.customer_name.split(' ')[0],
            store: entry.store_name || ''
          })));
        }
      } catch (err) {
        // Silent fail on auto-load
      }
    };
    autoLoad();
  }, []);

  const getStoreName = (entry) => entry.store || defaultStore || '';

  const addName = () => {
    setNames(prev => [...prev, { id: Date.now(), value: '', store: defaultStore }]);
  };

  const removeName = (id) => {
    if (names.length > 1) {
      setNames(prev => prev.filter(n => n.id !== id));
    }
  };

  const updateName = (id, value) => {
    setNames(prev => prev.map(n => n.id === id ? { ...n, value } : n));
  };

  const updateStore = (id, store) => {
    setNames(prev => prev.map(n => n.id === id ? { ...n, store } : n));
  };

  const handleBulkAdd = (text) => {
    const newNames = text.split(/[,\n]/).map(n => n.trim()).filter(Boolean);
    if (newNames.length > 0) {
      setNames(newNames.map((name, i) => ({ id: Date.now() + i, value: name, store: defaultStore })));
    }
  };

  const validNames = names.filter(n => n.value.trim());

  // Draw a heart fully contained within card bounds for PDF
  const drawPdfHeart = (pdf, cx, cy, size, r, g, b, clipX, clipY, clipW, clipH) => {
    pdf.saveGraphicsState();
    pdf.setFillColor(r, g, b);
    const s = size;

    // Only draw parts that are within the clip bounds
    const drawEllipseClipped = (ex, ey, rx, ry) => {
      // Simple check: only draw if center is within reasonable bounds
      if (ex + rx >= clipX && ex - rx <= clipX + clipW &&
          ey + ry >= clipY && ey - ry <= clipY + clipH) {
        pdf.ellipse(ex, ey, rx, ry, 'F');
      }
    };

    drawEllipseClipped(cx - s * 0.28, cy - s * 0.18, s * 0.32, s * 0.26);
    drawEllipseClipped(cx + s * 0.28, cy - s * 0.18, s * 0.32, s * 0.26);

    // Triangle
    const tx1 = cx - s * 0.58, ty1 = cy - s * 0.05;
    const tx2 = cx + s * 0.58, ty2 = cy - s * 0.05;
    const tx3 = cx, ty3 = cy + s * 0.52;
    pdf.triangle(tx1, ty1, tx2, ty2, tx3, ty3, 'F');

    pdf.restoreGraphicsState();
  };

  const handleDownloadPDF = () => {
    if (validNames.length === 0) return;

    // Accepts a map of { storeName: Image } for per-store logos
    const generatePdf = (logoImgMap) => {
      const pdf = new jsPDF('p', 'in', 'a4');
      const pageW = 8.27;
      const pageH = 11.69;
      const cols = 3;
      const rows = 3;
      const perPage = cols * rows;
      const marginX = 0.35;
      const marginY = 0.2;
      const gapX = 0.15;
      const gapY = 0.15;
      const cardW = (pageW - 2 * marginX - (cols - 1) * gapX) / cols;
      const cardH = (pageH - 2 * marginY - (rows - 1) * gapY) / rows;

      validNames.forEach((n, idx) => {
        const posOnPage = idx % perPage;
        const col = posOnPage % cols;
        const row = Math.floor(posOnPage / cols);

        if (idx > 0 && posOnPage === 0) {
          pdf.addPage();
        }

        const x = marginX + col * (cardW + gapX);
        const y = marginY + row * (cardH + gapY);
        const cardStore = getStoreName(n) || 'Store Name';
        const centerX = x + cardW / 2;

        // Card background - cream
        pdf.setFillColor(251, 247, 242);
        pdf.roundedRect(x, y, cardW, cardH, 0.08, 0.08, 'F');

        // Hearts INSIDE card bounds (positioned at corners but contained)
        drawPdfHeart(pdf, x + 0.25, y + 0.28, 0.42, 197, 222, 242, x, y, cardW, cardH);
        drawPdfHeart(pdf, x + cardW - 0.22, y + 0.3, 0.45, 197, 222, 242, x, y, cardW, cardH);
        drawPdfHeart(pdf, x + 0.22, y + cardH - 0.25, 0.32, 197, 222, 242, x, y, cardW, cardH);
        drawPdfHeart(pdf, x + cardW - 0.2, y + cardH - 0.22, 0.38, 197, 222, 242, x, y, cardW, cardH);
        drawPdfHeart(pdf, x + 0.26, y + cardH * 0.24, 0.08, 92, 184, 245, x, y, cardW, cardH);

        // Redraw card background edges to clean up any heart overflow
        pdf.setFillColor(255, 255, 255);
        pdf.rect(x - 0.02, y - 0.04, cardW + 0.04, 0.04, 'F');
        pdf.rect(x - 0.02, y + cardH, cardW + 0.04, 0.04, 'F');
        pdf.rect(x - 0.04, y - 0.02, 0.04, cardH + 0.04, 'F');
        pdf.rect(x + cardW, y - 0.02, 0.04, cardH + 0.04, 'F');

        // Store logo or store name
        const logoImg = logoImgMap[cardStore];
        if (logoImg) {
          const imgRatio = logoImg.naturalWidth / logoImg.naturalHeight;
          const logoH = 0.4;
          const logoW = Math.min(logoH * imgRatio, cardW * 0.65);
          const logoX = centerX - logoW / 2;
          const logoY = y + 0.3;
          const alias = 'logo-' + cardStore.replace(/[^a-zA-Z0-9]/g, '_');
          pdf.addImage(logoImg, 'PNG', logoX, logoY, logoW, logoH, alias, 'FAST');
        } else {
          const storeW = Math.min(1.5, cardW * 0.65);
          const storeH = 0.26;
          const storeX = centerX - storeW / 2;
          const storeY = y + 0.38;
          pdf.setFillColor(255, 255, 255);
          pdf.roundedRect(storeX, storeY, storeW, storeH, 0.03, 0.03, 'F');
          pdf.setFont('helvetica', 'bold');
          pdf.setFontSize(8);
          pdf.setTextColor(26, 26, 26);
          pdf.text(cardStore, centerX, storeY + 0.17, { align: 'center' });
        }

      // Content area - centered text
      // "Hi NAME," - positioned at ~38% from top, medium blue
      const hiY = y + cardH * 0.38;
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(13);
      pdf.setTextColor(21, 101, 192); // #1565C0 medium blue
      pdf.text(`Hi ${n.value},`, centerX, hiY, { align: 'center' });

      // "Thank" (serif, dark) + "you," (italic, indigo) - centered
      const thankY = hiY + 0.38;
      pdf.setFont('times', 'normal');
      pdf.setFontSize(20);
      pdf.setTextColor(13, 71, 161); // #0D47A1 dark blue
      const thankW = pdf.getTextWidth('Thank');
      pdf.setFont('times', 'italic');
      pdf.setFontSize(17);
      pdf.setTextColor(57, 73, 171); // #3949AB indigo
      const youW = pdf.getTextWidth('you,');

      // Calculate total width to center "Thank you, <3"
      const totalThankW = thankW + 0.06 + youW + 0.14;
      const thankStartX = centerX - totalThankW / 2;

      pdf.setFont('times', 'normal');
      pdf.setFontSize(20);
      pdf.setTextColor(13, 71, 161); // #0D47A1
      pdf.text('Thank', thankStartX, thankY);

      pdf.setFont('times', 'italic');
      pdf.setFontSize(17);
      pdf.setTextColor(57, 73, 171); // #3949AB
      pdf.text('you,', thankStartX + thankW + 0.06, thankY + 0.02);

      // Small heart after "you," - light grey
      drawPdfHeart(pdf, thankStartX + thankW + 0.06 + youW + 0.08, thankY - 0.03, 0.06, 192, 202, 216, x, y, cardW, cardH);

      // "for ordering from us!" - centered, medium blue
      const msg1Y = thankY + 0.4;
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(9);
      pdf.setTextColor(21, 101, 192); // #1565C0
      const thankLines = pdf.splitTextToSize(messages.thankYou, cardW - 0.4);
      pdf.text(thankLines, centerX, msg1Y, { align: 'center' });

      // "we packed it with LOVE just for you !" - centered, medium blue
      const msg2Y = msg1Y + thankLines.length * 0.16 + 0.22;
      const packedLines = pdf.splitTextToSize(messages.packed, cardW - 0.4);
      pdf.text(packedLines, centerX, msg2Y, { align: 'center' });

      // Support email at bottom
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(5.5);
      pdf.setTextColor(153, 153, 153);
      pdf.text('support@shopperskart.shop', centerX, y + cardH - 0.12, { align: 'center' });

      // Card border
      pdf.setDrawColor(230, 230, 230);
      pdf.setLineWidth(0.008);
      pdf.roundedRect(x, y, cardW, cardH, 0.08, 0.08);
      });

      pdf.save('personalized-notes.pdf');
    };

    // Preload all store logos, convert to PNG via canvas for reliable jsPDF embedding
    const storeNames = Object.keys(storeLogos);
    if (storeNames.length > 0) {
      const logoImgMap = {};
      let loaded = 0;
      const total = storeNames.length;
      const onDone = () => {
        loaded++;
        if (loaded === total) generatePdf(logoImgMap);
      };
      storeNames.forEach(storeName => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          const pngDataUrl = canvas.toDataURL('image/png');
          const pngImg = new Image();
          pngImg.onload = () => { logoImgMap[storeName] = pngImg; onDone(); };
          pngImg.onerror = () => onDone();
          pngImg.src = pngDataUrl;
        };
        img.onerror = () => onDone();
        img.src = storeLogos[storeName];
      });
    } else {
      generatePdf({});
    }
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4">Personalized Notes</Typography>
        <Button
          variant="contained"
          startIcon={<Download />}
          onClick={handleDownloadPDF}
          disabled={validNames.length === 0}
        >
          Download PDF
        </Button>
      </Box>

      <Grid container spacing={3}>
        {/* Left: Settings Panel */}
        <Grid item xs={12} md={4}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>Settings</Typography>

            <Typography variant="subtitle2" sx={{ mb: 1, mt: 1 }}>Default Store Name</Typography>
            {availableStores.length > 0 && (
              <FormControl fullWidth size="small" sx={{ mb: 1 }}>
                <InputLabel>Select from labels</InputLabel>
                <Select
                  value={defaultStore}
                  label="Select from labels"
                  onChange={(e) => setDefaultStore(e.target.value)}
                >
                  <MenuItem value="">-- None --</MenuItem>
                  {availableStores.map(store => (
                    <MenuItem key={store} value={store}>{store}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}
            <TextField
              fullWidth
              size="small"
              label="Or type store name"
              placeholder="e.g. ShoppersKart"
              value={defaultStore}
              onChange={(e) => setDefaultStore(e.target.value)}
              sx={{ mb: 1 }}
            />
            <Typography variant="caption" color="text.secondary">
              Used for manually added names. "From Labels" auto-assigns each customer's store.
            </Typography>

            <Divider sx={{ my: 2 }} />

            <Typography variant="subtitle2" sx={{ mb: 1 }}>Store Logos</Typography>
            <input
              type="file"
              accept="image/*"
              ref={logoInputRef}
              onChange={handleLogoUpload}
              style={{ display: 'none' }}
            />
            {availableStores.length > 0 ? (
              <Stack spacing={1} sx={{ mb: 1 }}>
                {availableStores.map(store => (
                  <Box key={store} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography variant="caption" sx={{ minWidth: 60, color: 'text.secondary', fontSize: '0.7rem' }} noWrap title={store}>
                      {store}
                    </Typography>
                    {storeLogos[store] ? (
                      <>
                        <Box
                          sx={{
                            border: '1px solid #e0e0e0',
                            borderRadius: 1,
                            p: 0.3,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            bgcolor: '#fafafa',
                            flex: 1,
                            minHeight: 30,
                          }}
                        >
                          <img
                            src={storeLogos[store]}
                            alt={store}
                            style={{ maxHeight: 28, maxWidth: '100%', objectFit: 'contain' }}
                          />
                        </Box>
                        <IconButton size="small" onClick={() => removeLogo(store)} color="error" title="Remove logo">
                          <Close sx={{ fontSize: 14 }} />
                        </IconButton>
                      </>
                    ) : (
                      <Button
                        variant="outlined"
                        size="small"
                        startIcon={<CloudUpload sx={{ fontSize: 14 }} />}
                        onClick={() => { setLogoUploadStore(store); setTimeout(() => logoInputRef.current.click(), 0); }}
                        sx={{ flex: 1, fontSize: '0.7rem', py: 0.3 }}
                      >
                        Upload
                      </Button>
                    )}
                  </Box>
                ))}
              </Stack>
            ) : (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                Load labels first to see available stores.
              </Typography>
            )}
            <Typography variant="caption" color="text.secondary">
              Upload a logo per store. Stores without a logo will show the store name as text.
            </Typography>

            <Divider sx={{ my: 2 }} />

            <Typography variant="subtitle2" sx={{ mb: 1 }}>Product</Typography>
            <FormControl fullWidth size="small" sx={{ mb: 1 }}>
              <InputLabel>Select product</InputLabel>
              <Select
                value={selectedProduct}
                label="Select product"
                onChange={(e) => { setSelectedProduct(e.target.value); loadFromLabels(e.target.value); }}
              >
                <MenuItem value="all">All Products</MenuItem>
                {availableProducts.map(product => (
                  <MenuItem key={product} value={product}>{product}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <Typography variant="caption" color="text.secondary">
              Filter customers by product when loading from labels.
            </Typography>

            <Divider sx={{ my: 2 }} />

            <Typography variant="subtitle2" sx={{ mb: 1 }}>Messages</Typography>
            <TextField
              fullWidth
              size="small"
              label="Thank you message"
              value={messages.thankYou}
              onChange={(e) => setMessages(prev => ({ ...prev, thankYou: e.target.value }))}
              multiline
              rows={2}
              sx={{ mb: 2 }}
            />
            <TextField
              fullWidth
              size="small"
              label="Closing message"
              value={messages.packed}
              onChange={(e) => setMessages(prev => ({ ...prev, packed: e.target.value }))}
              sx={{ mb: 2 }}
            />

            <Button
              size="small"
              onClick={() => setMessages({ ...NOTE_MESSAGES })}
              sx={{ textTransform: 'none' }}
            >
              Reset to default messages
            </Button>

            <Divider sx={{ my: 2 }} />

            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
              <Typography variant="subtitle2">
                Customer Names
                {validNames.length > 0 && (
                  <Chip label={validNames.length} size="small" color="primary" sx={{ ml: 1 }} />
                )}
              </Typography>
              <Button size="small" startIcon={<Add />} onClick={addName}>
                Add
              </Button>
            </Box>

            <TextField
              fullWidth
              size="small"
              label="Bulk add (comma or newline separated)"
              placeholder="Thomas, Sarah, John"
              multiline
              rows={2}
              onBlur={(e) => {
                if (e.target.value.trim()) {
                  handleBulkAdd(e.target.value);
                  e.target.value = '';
                }
              }}
              sx={{ mb: 2 }}
            />

            <Stack spacing={1} sx={{ maxHeight: 400, overflowY: 'auto' }}>
              {names.map((n, index) => (
                <Stack key={n.id} spacing={0.5}>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Typography variant="caption" sx={{ minWidth: 20, color: 'text.secondary' }}>
                      {index + 1}.
                    </Typography>
                    <TextField
                      fullWidth
                      size="small"
                      placeholder="Customer name"
                      value={n.value}
                      onChange={(e) => updateName(n.id, e.target.value)}
                    />
                    <IconButton
                      size="small"
                      onClick={() => removeName(n.id)}
                      disabled={names.length === 1}
                    >
                      <Delete fontSize="small" />
                    </IconButton>
                  </Stack>
                  <TextField
                    size="small"
                    placeholder="Store name"
                    value={n.store}
                    onChange={(e) => updateStore(n.id, e.target.value)}
                    sx={{ ml: '28px', '& .MuiInputBase-input': { fontSize: '0.8rem', py: 0.5 } }}
                    InputProps={{
                      startAdornment: (
                        <Typography variant="caption" sx={{ color: 'text.secondary', mr: 0.5, whiteSpace: 'nowrap' }}>
                          Store:
                        </Typography>
                      )
                    }}
                  />
                </Stack>
              ))}
            </Stack>
          </Paper>
        </Grid>

        {/* Right: Preview */}
        <Grid item xs={12} md={8}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>
              Preview
              {validNames.length > 0 && (
                <Typography component="span" variant="body2" color="text.secondary" sx={{ ml: 1 }}>
                  ({validNames.length} note{validNames.length !== 1 ? 's' : ''})
                </Typography>
              )}
            </Typography>

            {validNames.length === 0 ? (
              <Box sx={{ textAlign: 'center', py: 6, color: 'text.secondary' }}>
                <Typography variant="body1">Enter customer names to see the preview</Typography>
                <Box sx={{ mt: 3, display: 'flex', justifyContent: 'center' }}>
                  <NoteCard
                    name="Manjunath"
                    storeName="ShoppersKart"
                    storeLogo={storeLogos['ShoppersKart'] || ''}
                    messages={messages}
                    size="preview"
                  />
                </Box>
                <Typography variant="caption" sx={{ mt: 2, display: 'block' }}>
                  Sample preview
                </Typography>
              </Box>
            ) : (
              <Box
                id="print-area"
                ref={printRef}
                sx={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 2,
                  justifyContent: 'center',
                }}
              >
                {validNames.map(n => {
                  const store = getStoreName(n);
                  return (
                    <NoteCard
                      key={n.id}
                      name={n.value}
                      storeName={store}
                      storeLogo={storeLogos[store] || ''}
                      messages={messages}
                      size="preview"
                    />
                  );
                })}
              </Box>
            )}
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
};

export default PersonalizedNote;
