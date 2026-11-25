
'use strict';

/*
 * Label PDF Sorter v1.0
 * Runs locally in the browser.
 * PDF.js reads PDFs.
 * JavaScript matches references, SKUs, weights and quantities.
 * pdf-lib exports PDF pages; JSZip creates the ZIP.
 */

// ---------- 1. Application state ----------

const $ = (id) => document.getElementById(id);

const state = {
  labels: null,
  tickets: null,
  labelsBytes: null,
  rows: [],
  ticketsInfo: [],
  busy: false
};

const fmtBytes = (n) =>
  n >= 1048576
    ? (n / 1048576).toFixed(2) + ' MB'
    : (n / 1024).toFixed(1) + ' KB';

function notice(message, kind = '') {
  $('status').textContent = message;
  $('status').className = 'notice' + (kind ? ' ' + kind : '');
}

function busy(value, message = '') {
  state.busy = value;

  $('analyze').disabled =
    value || !(state.labels && state.tickets);

  $('clear').disabled = value;
  $('labels').disabled = value;
  $('tickets').disabled = value;
  $('progress').textContent = message;
}

function resetAnalysis() {
  state.labelsBytes = null;
  state.rows = [];
  state.ticketsInfo = [];

  $('labels-count').textContent = '—';
  $('tickets-count').textContent = '—';
  $('review-count').textContent = '—';

  $('confirmed').checked = false;
  $('export').disabled = true;

  $('results').classList.remove('visible');
  $('details').classList.remove('visible');
  $('export-panel').classList.remove('visible');

  $('result-rows').replaceChildren();
  $('sku-summary').replaceChildren();

  $('search').value = '';
  $('status-filter').value = 'ALL';

  $('sku-filter').replaceChildren(
    new Option('All SKUs', 'ALL')
  );
}

function updateFileDisplay() {
  for (const key of ['labels', 'tickets']) {
    const file = state[key];

    $('drop-' + key).classList.toggle(
      'selected',
      Boolean(file)
    );

    $('name-' + key).textContent = file
      ? file.name + ' · ' + fmtBytes(file.size)
      : 'Click or drag a PDF here';
  }

  $('files-count').textContent =
    [state.labels, state.tickets].filter(Boolean).length +
    ' / 2';

  busy(false);

  notice(
    state.labels && state.tickets
      ? 'Both files selected. Click Analyze PDFs.'
      : 'Choose two PDFs to begin.'
  );
}

// ---------- 2. File upload events ----------

for (const key of ['labels', 'tickets']) {
  const input = $(key);
  const zone = $('drop-' + key);

  input.addEventListener('change', () => {
    state[key] = input.files[0] || null;
    resetAnalysis();
    updateFileDisplay();
  });

  zone.addEventListener('dragover', (event) => {
    event.preventDefault();

    if (!state.busy) {
      zone.classList.add('dragging');
    }
  });

  zone.addEventListener('dragleave', () => {
    zone.classList.remove('dragging');
  });

  zone.addEventListener('drop', (event) => {
    event.preventDefault();
    zone.classList.remove('dragging');

    if (state.busy) return;

    const file = event.dataTransfer.files[0];
    if (!file) return;

    if (
      !file.name.toLowerCase().endsWith('.pdf') &&
      file.type !== 'application/pdf'
    ) {
      notice('Please choose a PDF file.', 'error');
      return;
    }

    state[key] = file;
    resetAnalysis();
    updateFileDisplay();
  });
}

$('clear').addEventListener('click', () => {
  for (const key of ['labels', 'tickets']) {
    state[key] = null;
    $(key).value = '';
  }

  resetAnalysis();
  updateFileDisplay();
});

// ---------- 3. PDF text extraction ----------

// PDF.js provides text and coordinates.
// Convert Y coordinates from bottom-origin to top-origin.

function getWords(textContent, pageHeight) {
  return textContent.items
    .filter(
      (item) =>
        typeof item.str === 'string' &&
        item.str.trim()
    )
    .map((item) => ({
      str: item.str.trim(),
      x: item.transform[4],
      y: pageHeight - item.transform[5]
    }));
}

// Extract the Reference number from an Extensiv Pick Ticket.

function referenceFromTicket(words) {
  const header = words.filter(
    (word) => word.y < 175
  );

  const candidates = header
    .filter(
      (word) =>
        /^[#＃]?\d{3,}$/.test(word.str) &&
        word.x > 265 &&
        word.x < 410
    )
    .sort((a, b) => a.y - b.y);

  const exact = candidates.find(
    (word) => word.str.startsWith('#')
  );

  if (exact) {
    return exact.str.slice(1);
  }

  const joined = header
    .map((word) => word.str)
    .join(' ');

  const match = joined.match(
    /Reference\s*#\s*:\s*#?\s*(\d+)/i
  );

  return match ? match[1] : null;
}

// Read every page of the Pick Ticket PDF.

async function extractTickets(file) {
  let documentHandle;
  const tickets = [];

  try {
    documentHandle = await pdfjsLib.getDocument({
      data: new Uint8Array(await file.arrayBuffer()),
      isEvalSupported: false
    }).promise;

    for (
      let pageNumber = 1;
      pageNumber <= documentHandle.numPages;
      pageNumber++
    ) {
      if (pageNumber % 10 === 0) {
        $('progress').textContent =
          `Reading Pick Tickets ${pageNumber}/${documentHandle.numPages}`;
      }

      const page =
        await documentHandle.getPage(pageNumber);

      const content =
        await page.getTextContent();

      const height =
        page.getViewport({ scale: 1 }).height;

      const words = getWords(content, height);

      const reference =
        referenceFromTicket(words);

      const items = [];

      // Locate SKU, quantity and weight in
      // the current Extensiv Pick Ticket table.
      // These coordinates depend on its PDF layout.

      for (const skuWord of words) {
        if (
          !(
            skuWord.x >= 32 &&
            skuWord.x <= 65 &&
            skuWord.y > 200 &&
            skuWord.y < 505
          )
        ) {
          continue;
        }

        if (
          !/^[A-Z0-9][A-Z0-9_-]{2,49}$/.test(
            skuWord.str
          )
        ) {
          continue;
        }

        const sameRow = (word) =>
          Math.abs(word.y - skuWord.y) <= 1.9;

        const quantityWord = words.find(
          (word) =>
            sameRow(word) &&
            word.x >= 400 &&
            word.x <= 459 &&
            /^\d+$/.test(word.str)
        );

        const weightWord = words.find(
          (word) =>
            sameRow(word) &&
            word.x >= 550 &&
            word.x <= 610 &&
            /^(?:\d+\.?\d*|\.\d+)$/.test(word.str)
        );

        if (
          !quantityWord ||
          !weightWord ||
          Number(quantityWord.str) <= 0
        ) {
          continue;
        }

        const qty = Number(
          quantityWord.str
        );

        const totalWeight = Number(
          weightWord.str
        );

        items.push({
          sku: skuWord.str,
          qty,
          weightEach: totalWeight / qty,
          ticketPage: pageNumber
        });
      }

      tickets.push({
        ref: reference,
        page: pageNumber,
        items
      });
    }
  } finally {
    if (documentHandle) {
      await documentHandle.destroy();
    }
  }

  return tickets;
}

// ---------- 4. Shipping Label extraction ----------

// FedEx may split tracking numbers into
// multiple positioned text elements.

function trackingFromWords(words) {
  const heading = words.find(
    (word) =>
      /^(?:TRK#|MPS#)$/i.test(word.str)
  );

  if (heading) {
    const parts = words
      .filter(
        (word) =>
          word.x > heading.x + 14 &&
          word.x < 160 &&
          Math.abs(word.y - heading.y) <= 5 &&
          /^[0-9 ]+$/.test(word.str)
      )
      .sort((a, b) => a.x - b.x)
      .map(
        (word) =>
          word.str.replace(/\s/g, '')
      );

    const number = parts.join('');

    if (/^\d{10,20}$/.test(number)) {
      return number;
    }
  }

  const text = words
    .map((word) => word.str)
    .join(' ');

  const match = text.match(
    /\b(?:TRK#|MPS#)\s*([0-9 ]{10,25})/i
  );

  return match
    ? match[1].replace(/\s/g, '')
    : null;
}

async function extractLabels(file) {
  let documentHandle;
  const labels = [];

  try {
    documentHandle = await pdfjsLib.getDocument({
      data: new Uint8Array(await file.arrayBuffer()),
      isEvalSupported: false
    }).promise;

    for (
      let pageNumber = 1;
      pageNumber <= documentHandle.numPages;
      pageNumber++
    ) {
      if (pageNumber % 10 === 0) {
        $('progress').textContent =
          `Reading Labels ${pageNumber}/${documentHandle.numPages}`;
      }

      const page =
        await documentHandle.getPage(pageNumber);

      const content =
        await page.getTextContent();

      const height =
        page.getViewport({ scale: 1 }).height;

      const words = getWords(content, height);

      const text = words
        .map((word) => word.str)
        .join(' ');

      // Example: INV: #4373
      const refMatch = text.match(
        /\bINV\s*:\s*#?\s*(\d+)/i
      );

      // Example: ACTWGT: 26.00 LB
      const weightMatch = text.match(
        /\bACTWGT\s*:\s*(\d*\.?\d+)\s*LB/i
      );

      const tracking =
        trackingFromWords(words);

      labels.push({
        page: pageNumber,
        ref: refMatch ? refMatch[1] : null,
        weight: weightMatch
          ? Number(weightMatch[1])
          : null,
        tracking,
        sku: 'REVIEW',
        status: 'REVIEW',
        reason: 'Not analyzed',
        ticketPage: null
      });
    }
  } finally {
    if (documentHandle) {
      await documentHandle.destroy();
    }
  }

  return labels;
}

// ---------- 5. Match labels to SKUs ----------

// Match by Reference, per-unit weight
// and package quantity.
// Do not assume corresponding page positions.

function autoMatch(labels, tickets) {
  const ticketsByRef = new Map();

  for (const ticket of tickets) {
    if (!ticket.ref) continue;

    if (!ticketsByRef.has(ticket.ref)) {
      ticketsByRef.set(ticket.ref, []);
    }

    ticketsByRef.get(ticket.ref).push(ticket);
  }

  const labelsByRef = new Map();

  for (const label of labels) {
    const key =
      label.ref ||
      '__MISSING_REF_PAGE_' + label.page;

    if (!labelsByRef.has(key)) {
      labelsByRef.set(key, []);
    }

    labelsByRef.get(key).push(label);
  }

  for (const [ref, group] of labelsByRef) {
    const correspondingTickets =
      ticketsByRef.get(ref) || [];

    const skuItems =
      correspondingTickets.flatMap(
        (ticket) => ticket.items
      );

    const expectedQty = skuItems.reduce(
      (sum, item) => sum + item.qty,
      0
    );

    let problem = '';

    if (!correspondingTickets.length) {
      problem =
        'Reference not found in Pick Tickets';
    } else if (!skuItems.length) {
      problem =
        'Unable to extract SKU, quantity or weight';
    } else if (expectedQty !== group.length) {
      problem =
        `Package count ${group.length} differs from Pick Ticket quantity ${expectedQty}`;
    } else if (
      group.some(
        (label) => label.weight === null
      )
    ) {
      problem =
        'ACTWGT missing on at least one label';
    }

    if (problem) {
      for (const label of group) {
        label.reason = problem;

        label.ticketPage =
          correspondingTickets
            .map((ticket) => ticket.page)
            .join(', ') || null;
      }

      continue;
    }

    // Expand quantities into individual packages.
    // Example: SKU A, Qty 2 => two matching slots.

    const slots = skuItems.flatMap(
      (item) =>
        Array.from(
          { length: item.qty },
          () => ({
            sku: item.sku,
            weight: item.weightEach,
            ticketPage: item.ticketPage,
            used: false
          })
        )
    );

    const provisional = [];
    let valid = true;

    for (const label of group) {
      const choices = slots.filter(
        (slot) =>
          !slot.used &&
          Math.abs(
            slot.weight - label.weight
          ) <= 0.02
      );

      const possibleSkus = new Set(
        choices.map((slot) => slot.sku)
      );

      // If multiple SKUs have the same weight,
      // automatic assignment is not safe.

      if (possibleSkus.size !== 1) {
        valid = false;
        break;
      }

      const chosen = choices[0];

      chosen.used = true;

      provisional.push({
        label,
        chosen
      });
    }

    if (
      valid &&
      provisional.length === group.length
    ) {
      for (const { label, chosen } of provisional) {
        label.sku = chosen.sku;
        label.status = 'AUTO';
        label.ticketPage = chosen.ticketPage;

        label.reason =
          'Reference + weight + quantity verified';
      }
    } else {
      for (const label of group) {
        label.reason =
          'Ambiguous or inconsistent SKU/weight assignment';

        label.ticketPage =
          correspondingTickets
            .map((ticket) => ticket.page)
            .join(', ') || null;
      }
    }
  }

  // Detect missing or duplicated tracking numbers.

  const seenTracks = new Map();

  for (const label of labels) {
    if (!label.tracking) {
      label.sku = 'REVIEW';
      label.status = 'REVIEW';
      label.reason =
        'Tracking number not extracted';

      continue;
    }

    if (seenTracks.has(label.tracking)) {
      const previous =
        seenTracks.get(label.tracking);

      for (const duplicate of [
        previous,
        label
      ]) {
        duplicate.sku = 'REVIEW';
        duplicate.status = 'REVIEW';
        duplicate.reason =
          'Duplicate tracking number: check source PDFs';
      }
    } else {
      seenTracks.set(
        label.tracking,
        label
      );
    }
  }

  return labels;
}

// ---------- 6. Render SKU summary ----------

function availableSkus() {
  return [
    ...new Set(
      state.ticketsInfo.flatMap(
        (ticket) =>
          ticket.items.map(
            (item) => item.sku
          )
      )
    )
  ].sort();
}

function updateSkuFilter() {
  const old = $('sku-filter').value;

  const skus = [
    ...new Set(
      state.rows.map(
        (row) => row.sku
      )
    )
  ].sort();

  $('sku-filter').replaceChildren(
    new Option('All SKUs', 'ALL')
  );

  for (const sku of skus) {
    $('sku-filter').append(
      new Option(sku, sku)
    );
  }

  $('sku-filter').value =
    skus.includes(old) ? old : 'ALL';
}

function renderSummary() {
  const count = new Map();

  const statusCounts = {
    AUTO: 0,
    MANUAL: 0,
    REVIEW: 0
  };

  for (const row of state.rows) {
    count.set(
      row.sku,
      (count.get(row.sku) || 0) + 1
    );

    statusCounts[row.status] =
      (statusCounts[row.status] || 0) + 1;
  }

  $('review-count').textContent =
    statusCounts.REVIEW;

  const grouped = [
    ...count.keys()
  ].filter(
    (sku) => sku !== 'REVIEW'
  ).length;

  $('overview').textContent =
    `${state.rows.length} labels · ${grouped} SKU groups · ${statusCounts.REVIEW} review`;

  $('validation-line').textContent =
    `Auto: ${statusCounts.AUTO} · Manual: ${statusCounts.MANUAL} · Review: ${statusCounts.REVIEW}`;

  const tbody = $('sku-summary');
  tbody.replaceChildren();

  const entries = [
    ...count.entries()
  ].sort(
    (a, b) =>
      a[0] === 'REVIEW'
        ? 1
        : b[0] === 'REVIEW'
          ? -1
          : b[1] - a[1]
  );

  for (const [sku, number] of entries) {
    const tr = tbody.insertRow();

    tr.insertCell().textContent = sku;

    const qty = tr.insertCell();
    qty.textContent = number;
    qty.className = 'count';

    const tag = tr.insertCell();

    tag.textContent =
      sku === 'REVIEW'
        ? 'Manual check'
        : 'Check before print';

    tag.className =
      sku === 'REVIEW'
        ? 'review'
        : 'ok';
  }

  updateSkuFilter();

  $('export').disabled =
    !state.rows.length ||
    !$('confirmed').checked ||
    state.busy;
}

// ---------- 7. Filters and detail table ----------

function matchesFilters(row) {
  const search = $('search').value
    .trim()
    .toLowerCase();

  const status =
    $('status-filter').value;

  const sku =
    $('sku-filter').value;

  if (
    status !== 'ALL' &&
    row.status !== status
  ) {
    return false;
  }

  if (
    sku !== 'ALL' &&
    row.sku !== sku
  ) {
    return false;
  }

  if (
    search &&
    ![
      row.ref ? '#' + row.ref : '',
      row.ref || '',
      row.sku,
      row.tracking || '',
      String(row.page)
    ].some(
      (value) =>
        String(value)
          .toLowerCase()
          .includes(search)
    )
  ) {
    return false;
  }

  return true;
}

function appendCell(
  tr,
  value,
  className = ''
) {
  const td = tr.insertCell();

  td.textContent =
    String(value ?? '—');

  if (className) {
    td.className = className;
  }

  return td;
}

function renderReviewTable() {
  const tbody = $('result-rows');
  tbody.replaceChildren();

  const skuOptions = [
    'REVIEW',
    ...availableSkus()
  ];

  const visibleRows =
    state.rows.filter(matchesFilters);

  const fragment =
    document.createDocumentFragment();

  for (const row of visibleRows) {
    const tr =
      document.createElement('tr');

    appendCell(tr, row.page);

    appendCell(
      tr,
      row.ref
        ? '#' + row.ref
        : 'NOT FOUND'
    );

    appendCell(
      tr,
      row.weight === null
        ? 'NOT FOUND'
        : row.weight.toFixed(2)
    );

    appendCell(
      tr,
      row.tracking || 'NOT FOUND'
    );

    // Editable SKU dropdown

    const select =
      document.createElement('select');

    select.className = 'sku-select';

    for (const sku of skuOptions) {
      select.append(
        new Option(sku, sku)
      );
    }

    select.value = row.sku;

    const skuCell = tr.insertCell();
    skuCell.append(select);

    const statusCell = appendCell(
      tr,
      row.status,
      row.status === 'AUTO'
        ? 'ok'
        : row.status === 'MANUAL'
          ? 'manual'
          : 'review'
    );

    const ticketPageCell =
      appendCell(
        tr,
        row.ticketPage ?? '—'
      );

    const reasonCell =
      appendCell(
        tr,
        row.reason
      );

    select.addEventListener(
      'change',
      () => {
        row.sku = select.value;

        row.status =
          row.sku === 'REVIEW'
            ? 'REVIEW'
            : 'MANUAL';

        row.reason =
          row.status === 'REVIEW'
            ? 'Manually placed into REVIEW'
            : 'Manually assigned SKU — verify the actual item';

        statusCell.textContent =
          row.status;

        statusCell.className =
          row.status === 'REVIEW'
            ? 'review'
            : 'manual';

        reasonCell.textContent =
          row.reason;

        ticketPageCell.textContent =
          String(
            row.ticketPage ?? '—'
          );

        // Any edit requires new confirmation.
        $('confirmed').checked = false;

        renderSummary();
        renderReviewTable();
      }
    );

    fragment.append(tr);
  }

  tbody.append(fragment);

  $('shown-count').textContent =
    `${visibleRows.length} of ${state.rows.length} labels shown`;

  if (!visibleRows.length) {
    const tr = tbody.insertRow();
    const td = tr.insertCell();

    td.colSpan = 8;
    td.textContent =
      'No labels match your filters.';
  }
}

for (const id of [
  'search',
  'status-filter',
  'sku-filter'
]) {
  $(id).addEventListener(
    id === 'search'
      ? 'input'
      : 'change',
    renderReviewTable
  );
}

$('reset-filters').addEventListener(
  'click',
  () => {
    $('search').value = '';
    $('status-filter').value = 'ALL';
    $('sku-filter').value = 'ALL';

    renderReviewTable();
  }
);

$('confirmed').addEventListener(
  'change',
  renderSummary
);

// ---------- 8. Analyze PDFs ----------

$('analyze').addEventListener(
  'click',
  async () => {
    if (
      !state.labels ||
      !state.tickets ||
      state.busy
    ) {
      return;
    }

    resetAnalysis();

    busy(
      true,
      'Reading PDF files...'
    );

    notice(
      'Analyzing. Keep this browser tab open.'
    );

    try {
      if (
        !window.pdfjsLib ||
        !window.PDFLib ||
        !window.JSZip
      ) {
        throw new Error(
          'Missing library files. Check the libs folder.'
        );
      }

      pdfjsLib.GlobalWorkerOptions.workerSrc =
        new URL(
          'libs/pdf.worker.min.js',
          location.href
        ).href;

      const [tickets, labels] =
        await Promise.all([
          extractTickets(
            state.tickets
          ),
          extractLabels(
            state.labels
          )
        ]);

      state.labelsBytes =
        new Uint8Array(
          await state.labels.arrayBuffer()
        );

      state.ticketsInfo = tickets;

      state.rows = autoMatch(
        labels,
        tickets
      );

      $('labels-count').textContent =
        labels.length;

      $('tickets-count').textContent =
        tickets.length;

      $('results').classList.add(
        'visible'
      );

      $('details').classList.add(
        'visible'
      );

      $('export-panel').classList.add(
        'visible'
      );

      renderSummary();
      renderReviewTable();

      const reviewCount =
        state.rows.filter(
          (row) =>
            row.status === 'REVIEW'
        ).length;

      notice(
        `${labels.length} labels analyzed. ${reviewCount} require manual review.`,
        'success'
      );
    } catch (error) {
      console.error(error);

      resetAnalysis();

      notice(
        `Unable to analyze these PDFs: ${error?.message || String(error)}. Do not use these results for printing.`,
        'error'
      );
    } finally {
      busy(false);
      renderSummary();
    }
  }
);

// ---------- 9. CSV export helpers ----------

const safeFileName = (name) =>
  String(name).replace(
    /[^a-zA-Z0-9_-]/g,
    '_'
  );

function escapeCsvCell(value) {
  let text = String(
    value ?? ''
  );

  // Prevent spreadsheet formula execution.
  if (
    /^[\s]*[=+\-@]/.test(text)
  ) {
    text = "'" + text;
  }

  return (
    '"' +
    text.replace(/"/g, '""') +
    '"'
  );
}

function makeCsv(headers, rows) {
  return [
    headers,
    ...rows
  ]
    .map(
      (row) =>
        row
          .map(escapeCsvCell)
          .join(',')
    )
    .join('\r\n');
}

function matchingManifest() {
  return makeCsv(
    [
      'Label Page',
      'Reference',
      'ACTWGT LB',
      'Tracking',
      'SKU',
      'Status',
      'Ticket Page',
      'Reason'
    ],
    state.rows.map(
      (row) => [
        row.page,
        row.ref,
        row.weight,
        row.tracking,
        row.sku,
        row.status,
        row.ticketPage,
        row.reason
      ]
    )
  );
}

function skuManifest() {
  const counts = new Map();

  for (const row of state.rows) {
    counts.set(
      row.sku,
      (counts.get(row.sku) || 0) + 1
    );
  }

  return makeCsv(
    ['SKU', 'Label Count'],
    [
      ...counts.entries()
    ].sort(
      (a, b) =>
        b[1] - a[1]
    )
  );
}

// ---------- 10. Export sorted PDF files ----------

$('export').addEventListener(
  'click',
  async () => {
    if (
      !state.labelsBytes ||
      !state.rows.length ||
      !$('confirmed').checked ||
      state.busy
    ) {
      return;
    }

    busy(
      true,
      'Creating grouped PDFs...'
    );

    $('export').disabled = true;

    try {
      // Open the original PDF without
      // redrawing labels or barcodes.
      const original =
        await PDFLib.PDFDocument.load(
          state.labelsBytes,
          {
            ignoreEncryption: false
          }
        );

      if (
        original.getPageCount() !==
        state.rows.length
      ) {
        throw new Error(
          'Input page count changed during processing.'
        );
      }

      const groups = new Map();
      const uniquePages = new Set();

      // Group original PDF pages by SKU.
      for (const row of state.rows) {
        if (
          !Number.isInteger(row.page) ||
          row.page < 1 ||
          row.page > state.rows.length ||
          uniquePages.has(row.page)
        ) {
          throw new Error(
            'Duplicate or invalid label page.'
          );
        }

        uniquePages.add(row.page);

        const key =
          row.sku || 'REVIEW';

        if (!groups.has(key)) {
          groups.set(key, []);
        }

        groups.get(key).push(
          row.page - 1
        );
      }

      if (
        uniquePages.size !==
        original.getPageCount()
      ) {
        throw new Error(
          'Not all label pages were accounted for.'
        );
      }

      const zip = new JSZip();

      let pagesWritten = 0;

      for (
        const [sku, pageIndices]
        of groups
      ) {
        const destination =
          await PDFLib.PDFDocument.create();

        const copiedPages =
          await destination.copyPages(
            original,
            pageIndices
          );

        for (const page of copiedPages) {
          destination.addPage(page);
        }

        const filename =
          sku === 'REVIEW'
            ? 'REVIEW_Labels.pdf'
            : `${safeFileName(sku)}_Labels_${pageIndices.length}.pdf`;

        const outputBytes =
          await destination.save({
            useObjectStreams: false
          });

        zip.file(
          filename,
          outputBytes
        );

        pagesWritten +=
          pageIndices.length;
      }

      if (
        pagesWritten !==
        original.getPageCount()
      ) {
        throw new Error(
          'Page accounting mismatch.'
        );
      }

      // Include CSV reports.
      zip.file(
        'Matching_Manifest.csv',
        matchingManifest()
      );

      zip.file(
        'SKU_Summary.csv',
        skuManifest()
      );

      zip.file(
        'READ_ME_FIRST.txt',
        `Label PDF Sorter v1.0\r\n\r\n` +
        `Input labels: ${state.rows.length}\r\n` +
        `Exported pages: ${pagesWritten}\r\n` +
        `SKU groups: ${
          [...groups.keys()].filter(
            (sku) => sku !== 'REVIEW'
          ).length
        }\r\n` +
        `REVIEW pages: ${
          groups.get('REVIEW')?.length || 0
        }\r\n\r\n` +
        'Review Matching_Manifest.csv and validate the physical products.\r\n' +
        'Files in REVIEW_Labels.pdf must be checked manually.\r\n' +
        'This utility does not authorize a shipment or check warehouse inventory.\r\n'
      );

      // Generate ZIP entirely in the browser.
      const blob =
        await zip.generateAsync({
          type: 'blob',
          compression: 'DEFLATE',
          compressionOptions: {
            level: 3
          }
        });

      const url =
        URL.createObjectURL(blob);

      const anchor =
        document.createElement('a');

      anchor.href = url;

      anchor.download =
        'Sorted_Labels_' +
        new Date()
          .toISOString()
          .slice(0, 10) +
        '.zip';

      document.body.append(anchor);
      anchor.click();
      anchor.remove();

      setTimeout(
        () =>
          URL.revokeObjectURL(url),
        120000
      );

      notice(
        `Export complete: ${pagesWritten}/${state.rows.length} labels written. Check the ZIP before printing.`,
        'success'
      );
    } catch (error) {
      console.error(error);

      notice(
        `Export failed: ${error?.message || String(error)}`,
        'error'
      );
    } finally {
      busy(false);
      renderSummary();
    }
  }
);

// ---------- 11. Initialize ----------

updateFileDisplay();

if (
  !window.pdfjsLib ||
  !window.PDFLib ||
  !window.JSZip
) {
  notice(
    'Missing PDF libraries. Check that all four JavaScript files are inside the libs folder.',
    'error'
  );
}
