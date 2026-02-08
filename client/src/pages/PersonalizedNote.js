import React, { useState, useRef } from 'react';
import {
  Box, Typography, TextField, Button, Paper, Grid, Stack,
  FormControl, InputLabel, Select, MenuItem, IconButton,
  Divider, Chip
} from '@mui/material';
import { Print, Download, Add, Delete, Favorite, Sync } from '@mui/icons-material';
import { useQuery } from 'react-query';
import axios from 'axios';
import jsPDF from 'jspdf';
import { toast } from 'react-hot-toast';

const NOTE_MESSAGES = {
  thankYou: 'Thank you so much for ordering from us!',
  packed: 'We packed it with care just for you'
};

const NoteCard = ({ name, storeName, messages, size }) => {
  const scale = size === 'print' ? 1 : 0.85;
  return (
    <Box
      sx={{
        width: size === 'print' ? '3.5in' : 280,
        height: size === 'print' ? '4.5in' : 340,
        border: '2px solid #e0e0e0',
        borderRadius: '16px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'space-between',
        p: size === 'print' ? '0.4in' : 3,
        bgcolor: '#fafafa',
        position: 'relative',
        overflow: 'hidden',
        boxSizing: 'border-box',
        pageBreakInside: 'avoid',
      }}
    >
      {/* Store Name Badge */}
      <Box
        sx={{
          border: '2px solid #555',
          borderRadius: '8px',
          px: 2.5,
          py: 0.5,
          mb: 1,
        }}
      >
        <Typography
          sx={{
            fontFamily: '"Segoe UI", Arial, sans-serif',
            fontWeight: 700,
            fontSize: 16 * scale,
            color: '#333',
            letterSpacing: 0.5,
          }}
        >
          {storeName || 'Store Name'}
        </Typography>
      </Box>

      {/* Main Content */}
      <Box
        sx={{
          border: '2px solid #d0d0d0',
          borderRadius: '12px',
          p: 2.5,
          flex: 1,
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          textAlign: 'center',
          bgcolor: '#f5f5f5',
          mt: 1,
        }}
      >
        {/* Greeting */}
        <Box sx={{ width: '100%', mb: 2 }}>
          <Typography
            component="span"
            sx={{
              fontFamily: '"Segoe UI", Arial, sans-serif',
              fontSize: 15 * scale,
              color: '#666',
            }}
          >
            Hi{' '}
          </Typography>
          <Typography
            component="span"
            sx={{
              fontFamily: '"Permanent Marker", "Comic Sans MS", cursive',
              fontSize: 28 * scale,
              fontWeight: 700,
              color: '#c0392b',
              textTransform: 'uppercase',
            }}
          >
            {name || 'NAME'}
          </Typography>
          <Typography
            component="span"
            sx={{
              fontFamily: '"Segoe UI", Arial, sans-serif',
              fontSize: 15 * scale,
              color: '#666',
            }}
          >
            ,
          </Typography>
        </Box>

        {/* Thank You Message */}
        <Typography
          sx={{
            fontFamily: '"Segoe UI", Arial, sans-serif',
            fontSize: 16 * scale,
            color: '#444',
            lineHeight: 1.6,
            mb: 2.5,
          }}
        >
          {messages.thankYou}
        </Typography>

        {/* Packed with care */}
        <Box sx={{ textAlign: 'center', maxWidth: '80%' }}>
          <Typography
            component="span"
            sx={{
              fontFamily: '"Segoe UI", Arial, sans-serif',
              fontSize: 15 * scale,
              color: '#444',
              lineHeight: 1.8,
            }}
          >
            We packed it with care just
          </Typography>
          <br />
          <Typography
            component="span"
            sx={{
              fontFamily: '"Segoe UI", Arial, sans-serif',
              fontSize: 15 * scale,
              color: '#444',
              lineHeight: 1.8,
            }}
          >
            for you
          </Typography>
          <Favorite sx={{ color: '#e74c3c', fontSize: 18 * scale, verticalAlign: 'middle', ml: 0.5 }} />
        </Box>

        {/* Support email */}
        <Typography
          sx={{
            fontFamily: '"Segoe UI", Arial, sans-serif',
            fontSize: 10 * scale,
            color: '#999',
            mt: 1.5,
          }}
        >
          support@shopperskart.shop
        </Typography>
      </Box>
    </Box>
  );
};

const PersonalizedNote = () => {
  // Each entry: { id, value (name), store (store name) }
  const [names, setNames] = useState([{ id: 1, value: '', store: '' }]);
  const [defaultStore, setDefaultStore] = useState('');
  const [messages, setMessages] = useState({ ...NOTE_MESSAGES });
  const printRef = useRef();

  // Fetch customer names with their store names from labels
  const { data: notesData, refetch } = useQuery(
    'personalized-notes-data',
    () => axios.get('/api/labels/personalized-notes-data').then(res => res.data),
    { staleTime: 0 }
  );

  const availableStores = notesData?.stores || [];
  const labelEntries = notesData?.entries || [];

  const loadFromLabels = async () => {
    // Always refetch fresh data when clicking "From Labels"
    const { data: freshData } = await refetch();
    const entries = freshData?.entries || [];
    if (entries.length === 0) {
      toast.error('No customer names found in uploaded labels. Re-upload labels to extract names.');
      return;
    }
    setNames(entries.map((entry, i) => ({
      id: Date.now() + i,
      value: entry.customer_name.split(' ')[0],
      store: entry.store_name || ''
    })));
    toast.success(`Loaded ${entries.length} customer name(s) from labels`);
  };

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

  const handlePrint = () => {
    const printContent = document.getElementById('print-area');
    if (!printContent) return;

    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
      <html>
        <head>
          <title>Personalized Notes</title>
          <link href="https://fonts.googleapis.com/css2?family=Permanent+Marker&display=swap" rel="stylesheet">
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { font-family: 'Segoe UI', Arial, sans-serif; }
            @page { size: A4; margin: 0; }
            .notes-grid {
              display: grid;
              grid-template-columns: repeat(3, 2.5in);
              gap: 0.15in;
              padding: 0.2in 0.35in;
              justify-content: center;
            }
            .note-card {
              width: 2.5in;
              height: 3.6in;
              border: 1.5px solid #e0e0e0;
              border-radius: 12px;
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: space-between;
              padding: 0.2in;
              background: #fafafa;
              page-break-inside: avoid;
            }
            .store-badge {
              border: 1.5px solid #555;
              border-radius: 6px;
              padding: 2px 12px;
              margin-bottom: 4px;
            }
            .store-name {
              font-weight: 700;
              font-size: 11px;
              color: #333;
              letter-spacing: 0.3px;
            }
            .content-box {
              border: 1.5px solid #d0d0d0;
              border-radius: 10px;
              padding: 10px;
              flex: 1;
              width: 100%;
              display: flex;
              flex-direction: column;
              justify-content: center;
              align-items: center;
              text-align: center;
              background: #f5f5f5;
              margin-top: 4px;
            }
            .greeting { margin-bottom: 8px; }
            .greeting-text { font-size: 11px; color: #666; }
            .customer-name {
              font-family: 'Permanent Marker', cursive;
              font-size: 20px;
              font-weight: 700;
              color: #c0392b;
              text-transform: uppercase;
            }
            .thank-msg {
              font-size: 11px;
              color: #444;
              line-height: 1.5;
              margin-bottom: 10px;
            }
            .packed-msg {
              font-size: 11px;
              color: #444;
              line-height: 1.5;
            }
            .heart {
              color: #e74c3c;
              font-size: 13px;
              vertical-align: middle;
              margin-left: 2px;
            }
            .support-email {
              font-size: 8px;
              color: #999;
              margin-top: 8px;
            }
            @media print {
              body { margin: 0; }
              .notes-grid { padding: 0.2in 0.35in; gap: 0.15in; }
              .note-card { break-inside: avoid; }
            }
          </style>
        </head>
        <body>
          <div class="notes-grid">
            ${validNames.map(n => `
              <div class="note-card">
                <div class="store-badge">
                  <span class="store-name">${getStoreName(n) || 'Store Name'}</span>
                </div>
                <div class="content-box">
                  <div class="greeting">
                    <span class="greeting-text">Hi </span>
                    <span class="customer-name">${n.value}</span>
                    <span class="greeting-text">,</span>
                  </div>
                  <div class="thank-msg">${messages.thankYou}</div>
                  <div class="packed-msg">
                    We packed it with care just<br/>for you <span class="heart">&#10084;</span>
                  </div>
                  <div class="support-email">support@shopperskart.shop</div>
                </div>
              </div>
            `).join('')}
          </div>
        </body>
      </html>
    `);
    printWindow.document.close();
    setTimeout(() => {
      printWindow.print();
    }, 500);
  };

  const handleDownloadPDF = () => {
    if (validNames.length === 0) return;

    // A4: 8.27in x 11.69in, 3x3 grid = 9 notes per page
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

      // Card border
      pdf.setDrawColor(200);
      pdf.setLineWidth(0.015);
      pdf.roundedRect(x, y, cardW, cardH, 0.1, 0.1);

      // Store badge
      const badgeW = Math.min(1.4, cardW * 0.6);
      const badgeH = 0.28;
      const badgeX = x + (cardW - badgeW) / 2;
      const badgeY = y + 0.18;
      pdf.setDrawColor(85);
      pdf.setLineWidth(0.015);
      pdf.roundedRect(badgeX, badgeY, badgeW, badgeH, 0.06, 0.06);
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(9);
      pdf.setTextColor(51);
      pdf.text(cardStore, x + cardW / 2, badgeY + 0.19, { align: 'center' });

      // Inner content box
      const innerX = x + 0.15;
      const innerY = badgeY + badgeH + 0.12;
      const innerW = cardW - 0.3;
      const innerH = cardH - (innerY - y) - 0.15;
      pdf.setDrawColor(190);
      pdf.setFillColor(245, 245, 245);
      pdf.roundedRect(innerX, innerY, innerW, innerH, 0.08, 0.08, 'FD');

      // Greeting
      const centerX = innerX + innerW / 2;
      let textY = innerY + innerH * 0.28;

      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(9);
      pdf.setTextColor(102);
      const hiWidth = pdf.getTextWidth('Hi ');
      const nameText = n.value.toUpperCase();
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(15);
      pdf.setTextColor(192, 57, 43);
      const nameWidth = pdf.getTextWidth(nameText);
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(9);
      pdf.setTextColor(102);
      const commaWidth = pdf.getTextWidth(',');

      const totalW = hiWidth + nameWidth + commaWidth;
      const startX = centerX - totalW / 2;

      pdf.text('Hi ', startX, textY);
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(15);
      pdf.setTextColor(192, 57, 43);
      pdf.text(nameText, startX + hiWidth, textY);
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(9);
      pdf.setTextColor(102);
      pdf.text(',', startX + hiWidth + nameWidth, textY);

      // Thank you message
      textY += 0.4;
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(9);
      pdf.setTextColor(68);
      const thankLines = pdf.splitTextToSize(messages.thankYou, innerW - 0.3);
      pdf.text(thankLines, centerX, textY, { align: 'center' });

      // Packed message - line 1: "We packed it with care just"
      textY += thankLines.length * 0.18 + 0.3;
      pdf.setFontSize(9);
      pdf.setTextColor(68);
      pdf.text('We packed it with care just', centerX, textY, { align: 'center' });

      // Line 2: "for you" + heart
      textY += 0.18;
      const forYouText = 'for you';
      const forYouWidth = pdf.getTextWidth(forYouText);
      const forYouStartX = centerX - (forYouWidth + 0.15) / 2;
      pdf.text(forYouText, forYouStartX, textY);

      // Draw heart shape after "for you"
      const heartX = forYouStartX + forYouWidth + 0.1;
      const heartY = textY - 0.06;
      const hs = 0.07;
      pdf.setFillColor(231, 76, 60);
      pdf.ellipse(heartX - hs * 0.5, heartY - hs * 0.3, hs * 0.55, hs * 0.45, 'F');
      pdf.ellipse(heartX + hs * 0.5, heartY - hs * 0.3, hs * 0.55, hs * 0.45, 'F');
      pdf.triangle(
        heartX - hs * 1.05, heartY - hs * 0.15,
        heartX + hs * 1.05, heartY - hs * 0.15,
        heartX, heartY + hs * 1.0,
        'F'
      );

      // Support email
      textY += 0.25;
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(6);
      pdf.setTextColor(153);
      pdf.text('support@shopperskart.shop', centerX, textY, { align: 'center' });
    });

    pdf.save('personalized-notes.pdf');
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4">Personalized Notes</Typography>
        <Stack direction="row" spacing={1}>
          <Button
            variant="outlined"
            startIcon={<Print />}
            onClick={handlePrint}
            disabled={validNames.length === 0}
          >
            Print
          </Button>
          <Button
            variant="contained"
            startIcon={<Download />}
            onClick={handleDownloadPDF}
            disabled={validNames.length === 0}
          >
            Download PDF
          </Button>
        </Stack>
      </Box>

      <Grid container spacing={3}>
        {/* Left: Settings Panel */}
        <Grid item xs={12} md={4}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>Settings</Typography>

            {/* Default Store Name (for manually added names) */}
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
              placeholder="e.g. ZenGoods"
              value={defaultStore}
              onChange={(e) => setDefaultStore(e.target.value)}
              sx={{ mb: 1 }}
            />
            <Typography variant="caption" color="text.secondary">
              Used for manually added names. "From Labels" auto-assigns each customer's store.
            </Typography>

            <Divider sx={{ my: 2 }} />

            {/* Messages */}
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

            {/* Customer Names */}
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
              <Typography variant="subtitle2">
                Customer Names
                {validNames.length > 0 && (
                  <Chip label={validNames.length} size="small" color="primary" sx={{ ml: 1 }} />
                )}
              </Typography>
              <Stack direction="row" spacing={0.5}>
                <Button size="small" startIcon={<Sync />} onClick={loadFromLabels} color="secondary">
                  From Labels
                </Button>
                <Button size="small" startIcon={<Add />} onClick={addName}>
                  Add
                </Button>
              </Stack>
            </Box>

            {/* Bulk paste */}
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
                    name="THOMAS"
                    storeName="ZenGoods"
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
                {validNames.map(n => (
                  <NoteCard
                    key={n.id}
                    name={n.value}
                    storeName={getStoreName(n)}
                    messages={messages}
                    size="preview"
                  />
                ))}
              </Box>
            )}
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
};

export default PersonalizedNote;
