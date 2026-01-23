const parse835 = (content) => {
  const segments = content.replace(/\r/g, '').split('~').map((s) => s.trim()).filter(Boolean);
  const rows = [];
  const errors = [];
  let currentClaim = null;
  segments.forEach((segment, index) => {
    const parts = segment.split('*');
    const tag = parts[0];
    if (tag === 'CLP') {
      if (!parts[1]) {
        errors.push({ line: index + 1, message: 'CLP sin identificador de claim' });
      }
      currentClaim = {
        patientControlNumber: parts[1] || '',
        payerClaimNumber: parts[7] || '',
        trackingNumber: '',
        charged: Number(parts[3] || 0),
        paid: Number(parts[4] || 0),
        patientResp: Number(parts[5] || 0),
        adjustments: [],
      };
      rows.push(currentClaim);
    }
    if (tag === 'TRN' && parts[1] === '1' && currentClaim) {
      currentClaim.trackingNumber = parts[2] || '';
    }
    if (tag === 'CAS' && currentClaim) {
      const groupCode = parts[1];
      for (let i = 2; i < parts.length; i += 3) {
        const reasonCode = parts[i];
        const amount = Number(parts[i + 1] || 0);
        if (!reasonCode) continue;
        currentClaim.adjustments.push({ groupCode, reasonCode, amount });
      }
    }
  });
  return { rows, errors };
};

const parse277 = (content) => {
  const segments = content.replace(/\r/g, '').split('~').map((s) => s.trim()).filter(Boolean);
  const rows = [];
  const errors = [];
  let trackingNumber = '';
  let patientControlNumber = '';
  segments.forEach((segment, index) => {
    const parts = segment.split('*');
    const tag = parts[0];
    if (tag === 'TRN' && parts[1] === '1') {
      trackingNumber = parts[2] || '';
    }
    if (tag === 'REF' && parts[1] === '1K') {
      patientControlNumber = parts[2] || '';
    }
    if (tag === 'STC') {
      const status = parts[1] || '';
      if (!status) {
        errors.push({ line: index + 1, message: 'STC sin status' });
      }
      rows.push({
        status,
        trackingNumber,
        patientControlNumber,
      });
    }
  });
  return { rows, errors };
};

const parse999 = (content) => {
  if (!content) return { rows: [], errors: [{ line: 1, message: '999 vacío' }] };
  return { rows: [{ status: '999_ACK' }], errors: [] };
};

const parseCsv = (content) => {
  const lines = content.replace(/\r/g, '').split('\n').filter((line) => line.trim().length);
  const errors = [];
  if (lines.length < 2) {
    return { rows: [], errors: [{ line: 1, message: 'CSV sin filas de datos' }] };
  }
  const headers = lines[0].split(',').map((h) => h.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cells = lines[i].split(',');
    const row = {};
    headers.forEach((header, idx) => {
      row[header] = cells[idx] || '';
    });
    rows.push(row);
  }
  return { rows, errors };
};

const detectEdiType = (fileName, content) => {
  const upper = `${fileName} ${content}`.toUpperCase();
  if (fileName.toLowerCase().endsWith('.csv')) return 'CSV';
  if (upper.includes('835') || upper.includes('BPR') || upper.includes('CLP')) return '835';
  if (upper.includes('277') || upper.includes('STC')) return '277CA';
  if (upper.includes('999')) return '999';
  return 'unknown';
};

export { detectEdiType, parse277, parse835, parse999, parseCsv };
