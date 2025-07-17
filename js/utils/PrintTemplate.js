import { ChargesCalculator } from './ChargesCalculator.js';

/**
 * PrintTemplate.js - Classes for managing thermal printer receipt templates
 * This module provides PrintSection and PrintTemplate classes for creating and managing
 * receipt templates for thermal printers.
 */

/**
 * PrintSection represents a section of content in a receipt template
 * with its own formatting options
 */
export class PrintSection {
    constructor(options = {}) {
        this.template = options.template || '';
        this.alignment = options.alignment || 'TextAlign.left';
        this.fontSize = options.fontSize || 20;
        this.isBold = options.isBold || false;
        this.variables = {};
    }

    /**
     * Process content variables and replace with actual values
     * @returns {string} Processed content with variables replaced
     */
    resolveVariables() {
        if (!this.template) return '';

        let result = this.template;

        // Replace all variable placeholders with their values
        Object.entries(this.variables).forEach(([key, value]) => {
            const placeholder = `#${key}`;
            if (result.includes(placeholder)) {
                // If the value is undefined, empty string or just whitespace, replace with empty string
                const replacement = (value === undefined || value === null || String(value).trim() === '') ? '' : value;
                result = result.replace(new RegExp(placeholder, 'g'), replacement);
            }
        });

        // Clean up any lines that only contain an empty placeholder
        result = result.split('\n')
            .filter(line => line.trim() !== '')
            .join('\n');

        return result;
    }

    /**
     * Generate HTML representation of this section for preview or printing
     * @returns {string} HTML content
     */
    toHTML() {
        const content = this.resolveVariables();
        if (!content.trim()) return '';

        // Map alignment to Tailwind classes
        let alignClass;
        switch (this.alignment) {
            case 'TextAlign.center': alignClass = 'text-center'; break;
            case 'TextAlign.right': alignClass = 'text-right'; break;
            default: alignClass = 'text-left'; break;
        }

        // Map font size and bold to Tailwind classes
        const fontSizeClass = this.fontSize > 24 ? 'text-lg' : '';
        const boldClass = this.isBold ? 'font-bold' : '';

        let html = `<div class="${alignClass} ${fontSizeClass} ${boldClass} w-full whitespace-pre-wrap overflow-hidden my-1">`;

        // Process each line individually
        const lines = content.split('\n');
        lines.forEach((line, index) => {
            if (line.trim()) {
                html += `${line}${index < lines.length - 1 ? '<br>' : ''}`;
            }
        });

        html += `</div>`;

        return html;
    }
}

export class PrintTemplate {
    /**
     * Create a new PrintTemplate
     * @param {Object} options - Options for template creation
     * @param {string} options.type - 'bill' or 'kot'
     * @param {number} options.printerWidth - The printer width in characters
     * @param {Array} options.sections - Array of section configurations
     * @param {Object} options.orderData - Order data for context-specific templates
     * @param {Object} options.seller - Seller data with business information
     * @param {Object} options.templateData - Custom template data (optional)
     */
    constructor(options = {}) {
        const {
            type = 'bill',
            printerWidth = 48,
            sections = [],
            orderData = {},
            seller = {},
            templateData = null
        } = options;

        this.type = type;
        this.printerWidth = printerWidth;
        this.encoder = new TextEncoder();
        this.variables = {};

        // Initialize sections based on provided template data, sections, or defaults
        if (templateData) {
            this.type = templateData.type || type;
            this.sections = (templateData.sections || []).map(section => new PrintSection(section));
        } else if (sections && sections.length > 0) {
            this.sections = sections.map(section => new PrintSection(section));
        } else {
            // Create default template based on type
            this.sections = this.type.toLowerCase() === 'kot'
                ? this._createDefaultKOTSections(orderData)
                : this._createDefaultBillSections(orderData);
        }

        // Process order data if provided
        if (orderData && Object.keys(orderData).length > 0) {
            this.processOrderData(orderData, { seller });
        }
    }

    /**
     * Process order data and prepare template variables
     * @param {Object} orderData - The order data
     * @param {Object} options - Additional options (seller info)
     */
    processOrderData(orderData, options = {}) {
        const { seller = {} } = options;

        // Generate variables from order data
        this.variables = this._prepareVariablesFromOrder(orderData, seller);

        // Apply variables to all sections
        this.sections.forEach(section => {
            section.variables = this.variables;
        });
    }

    /**
     * Generate HTML for the template as a complete HTML document
     * @returns {string} Complete HTML document ready for preview or printing
     */
    toHTML() {
        // Generate the content HTML
        let contentHtml = `<div class="printer-container w-full max-w-[58mm] mx-auto p-0 text-black">`;

        this.sections.forEach(section => {
            const sectionHtml = section.toHTML();
            if (sectionHtml) {
                contentHtml += sectionHtml;
                contentHtml += `<div class="border-b border-dashed border-gray-300"></div>`;
            }
        });

        contentHtml += `</div>`;

        // Return a complete HTML document
        return `
            <html>
                <head>
                    <script src="https://cdn.tailwindcss.com"></script>
                </head>
                <body>${contentHtml}</body>
            </html>
        `;
    }

    /**
     * Generate complete ESC/POS commands for all sections
     * @returns {Promise<Uint8Array>} Complete command bytes
     */
    async toPrinterCommands() {
        // Get HTML content from toHTML method
        const htmlContent = this.toHTML();

        // Create an iframe to render the HTML
        const iframe = document.createElement('iframe');
        iframe.style.visibility = 'hidden';
        iframe.style.position = 'absolute';
        document.body.appendChild(iframe);

        // Write HTML content to iframe with additional styles to remove margins
        iframe.contentDocument.open();
        iframe.contentDocument.write(htmlContent);
        iframe.contentDocument.close();

        // Wait for iframe content to load any images
        await new Promise(resolve => {
            iframe.onload = resolve;
            setTimeout(resolve, 1000); // Fallback timeout
        });

        // Get the printer container element directly
        const receiptContent = iframe.contentDocument.querySelector('.printer-container');

        // Force a layout calculation to ensure accurate dimensions
        receiptContent.style.margin = '0';
        receiptContent.style.padding = '0';

        // Wait a bit for layout to stabilize
        await new Promise(resolve => setTimeout(resolve, 100));

        // Get the content dimensions after layout is stable
        const width = receiptContent.offsetWidth;
        const height = receiptContent.offsetHeight;

        console.log(`Receipt content dimensions: ${width}x${height}`);

        // Check if html2canvas is available
        if (typeof html2canvas !== 'function') {
            console.error('html2canvas library is required but not loaded');
            throw new Error('html2canvas library is required');
        }

        // Capture the receipt content as PNG - capture only the container, not the body
        const receiptCanvas = await html2canvas(receiptContent, {
            backgroundColor: '#FFFFFF',
            scale: 2,
            useCORS: true,
            allowTaint: true,
            logging: false
        });
        
        // Convert canvas to data URL
        const pngDataUrl = receiptCanvas.toDataURL('image/png');

        // // Open preview window
        // this._openPreviewWindow(pngDataUrl, receiptContent);

        // Clean up
        document.body.removeChild(iframe);

        // Generate ESC/POS commands for printing the image
        const commands = [];

        // Initialize printer
        commands.push(0x1B, 0x40); // ESC @ - Initialize printer

        // Set print density and print speed to maximum density
        commands.push(0x1D, 0x28, 0x4B, 0x02, 0x00, 0x32, 0x04); // GS ( K pL pH fn m (density=4, highest)

        // Set print density to highest level for darker print
        commands.push(0x1D, 0x7C, 0x08); // GS | n - Set print density to maximum (8)

        // Create a temporary canvas to process the image
        const img = new Image();
        await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
            img.src = pngDataUrl;
        });

        // Calculate optimal printer width in pixels (standard thermal printer is 384px)
        const printerWidthPx = 384;

        // Create canvas with full printer width
        const processingCanvas = document.createElement('canvas');

        // Use the content width we already have for scaling calculation
        const scaleFactor = printerWidthPx / width;

        processingCanvas.width = printerWidthPx;
        processingCanvas.height = Math.round(height * scaleFactor);

        const ctx = processingCanvas.getContext('2d');
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, processingCanvas.width, processingCanvas.height);

        // Draw image scaled to fill width
        ctx.drawImage(img, 0, 0, processingCanvas.width, processingCanvas.height);

        // Apply contrast enhancement
        const imageData = ctx.getImageData(0, 0, processingCanvas.width, processingCanvas.height);
        const pixels = imageData.data;

        // Enhance contrast for better printing
        for (let i = 0; i < pixels.length; i += 4) {
            // Get grayscale value
            const avg = (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3;

            // Apply extreme contrast for very dark prints
            const newVal = avg < 200 ? 0 : 255; // Binary threshold for maximum contrast

            pixels[i] = pixels[i + 1] = pixels[i + 2] = newVal;
        }

        ctx.putImageData(imageData, 0, 0);

        // Calculate bytes per line for the printer
        const widthBytes = Math.ceil(processingCanvas.width / 8);

        // Pre-allocate the buffer for better performance
        const monochromeData = new Uint8Array(widthBytes * processingCanvas.height);

        // Convert RGBA to 1-bit monochrome with improved contrast
        for (let y = 0; y < processingCanvas.height; y++) {
            for (let x = 0; x < processingCanvas.width; x++) {
                const pixelIndex = (y * processingCanvas.width + x) * 4;
                // Calculate grayscale value with better weighting for human perception
                const grayscale =
                    0.299 * pixels[pixelIndex] +
                    0.587 * pixels[pixelIndex + 1] +
                    0.114 * pixels[pixelIndex + 2];

                // Use a much higher threshold for significantly darker print
                if (grayscale < 220) { // Much higher threshold = much darker print
                    const byteIndex = y * widthBytes + Math.floor(x / 8);
                    const bitIndex = 7 - (x % 8); // MSB first
                    monochromeData[byteIndex] |= (1 << bitIndex);
                }
            }
        }

        // OPTIMIZATION: Use more efficient raster bit image command
        // GS v 0 - Print raster bit image
        commands.push(0x1D, 0x76, 0x30, 0);

        // Set image dimensions
        commands.push(widthBytes & 0xFF, (widthBytes >> 8) & 0xFF); // xL, xH - width bytes
        commands.push(processingCanvas.height & 0xFF, (processingCanvas.height >> 8) & 0xFF); // yL, yH - height pixels

        // Add the monochrome image data
        for (let i = 0; i < monochromeData.length; i++) {
            commands.push(monochromeData[i]);
        }

        // Feed paper and cut
        commands.push(0x1B, 0x64, 0x02); // Feed 5 lines
        commands.push(0x1D, 0x56, 0x41, 0x10); // Paper cut

        // Log command length for debugging
        console.log(`Generated ESC/POS commands: ${commands.length} bytes`);

        return new Uint8Array(commands);
    }

    /**
     * Prepare variables from order data (private method)
     * @param {Object} orderData - The order data
     * @param {Object} seller - Seller data
     * @returns {Object} Variables for template
     * @private
     */
    _prepareVariablesFromOrder(orderData, seller) {
        const variables = {
            // Basic business info
            businessName: `${seller.businessName || 'Your Business'}`,
            logo: seller.logo ?
                `<div class="text-center"><img src="${seller.logo}" alt="Logo" class="max-w-[200px] max-h-[60px] mx-auto"></div>` :
                '<div class="text-center"><i class="ph ph-storefront text-2xl"></i></div>',
            phone: seller.phone ? `${seller.phone}` : '',
            address: seller.address ? `${seller.address}` : '',
            storeLink: seller.website ? `${seller.website}` : '',
            gstIN: seller.gstIN ? `${seller.gstIN}` : '',

            // Order details
            billNo: `${orderData.billNo || orderData.id?.substring(0, 8) || 'N/A'}`,
            orderSource: `${orderData.priceVariant || 'Default'}`,
            payMode: `${orderData.payMode || 'CASH'}`,
            timestamp: `${new Date(orderData.date?.toDate ? orderData.date.toDate() : orderData.date || new Date()).toLocaleString()}`,
            cut: '<div class="border-t border-dashed my-1 border-gray-400"></div>',
            upiQR: orderData.upiQR ? `<div class="text-center"><i class="ph ph-qr-code text-4xl"></i></div>` : '',
            instructions: orderData.instructions ? `Instructions:\n${orderData.instructions}` : '',
            customerName: orderData.customer?.name || orderData.custName || '',
            customerPhone: orderData.customer?.phone || orderData.custPhone || '',

            // Add bulk tax update hashtag if present
            bulkTaxHashtag: orderData.taxUpdateInfo?.hashtag || ''
        };

        // Prepare items list for both templates if items exist
        if (orderData.items && orderData.items.length > 0) {
            // For bill template
            variables.itemsList = this._generateBillItemsList(orderData.items);

            // For KOT template
            variables.kotItemsList = this._generateKOTItemsList(orderData.items);

            // Calculate subtotal for bill
            const subtotal = orderData.items.reduce((total, item) => {
                const quantity = parseFloat(item.quantity || item.qnt || 1);
                const price = parseFloat(item.price || 0);
                return total + (quantity * price);
            }, 0);

            variables.subtotal = `${subtotal.toFixed(2)}`;

            // Handle discount
            const discount = orderData.discount ? parseFloat(orderData.discount) : 0;
            if (discount > 0) {
                variables.discount = `-${discount.toFixed(2)}`;
            } else {
                variables.discount = '';
            }

            // Handle charges
            let chargesHtml = '';
            let hasBulkTaxUpdate = false;
            let bulkTaxHashtag = null;
            let total = 0; // Initialize total variable

            // Use ChargesCalculator for consistent charge calculations
            if (orderData.charges && Array.isArray(orderData.charges)) {
                const chargesCalculation = ChargesCalculator?.calculateCharges(
                    subtotal,
                    orderData.charges,
                    orderData.discount || 0
                );

                if (chargesCalculation && chargesCalculation.calculatedCharges) {
                    chargesCalculation.calculatedCharges.forEach(charge => {
                        chargesHtml += `${charge.displayName}: ${charge.calculatedAmount.toFixed(2)}\n`;

                        // Check if this charge has a bulk tax update hashtag
                        if (charge.bulkTaxHashtag) {
                            hasBulkTaxUpdate = true;
                            bulkTaxHashtag = charge.bulkTaxHashtag;
                        }
                    });

                    // Add bulk tax update information if present
                    if (hasBulkTaxUpdate && bulkTaxHashtag) {
                        chargesHtml += `\n${bulkTaxHashtag}\n`;
                    }

                    // Use the calculated final amount
                    total = chargesCalculation.finalAmount;
                }
            }
            variables.charges = chargesHtml;

            // Handle total
            if (!total) {
                total = subtotal;
                if (orderData.discount) {
                    total -= parseFloat(orderData.discount);
                }
            }

            variables.total = `${typeof total === 'number' ? total.toFixed(2) : total || '0.00'}`;
        }

        return variables;
    }

    /**
     * Generate HTML for bill items list
     * @param {Array} items - Order items
     * @returns {string} HTML for items list
     * @private
     */
    _generateBillItemsList(items) {
        let html = `<div class="flex w-full font-bold border-b border-dashed border-gray-400 text-xs m-0 p-0">
            <div class="w-[10%]">Qty</div>
            <div class="w-[70%]">Item</div>
            <div class="w-[20%] text-right">Amt</div>
        </div>`;

        // Add items
        items.forEach(item => {
            const quantity = parseFloat(item.quantity || item.qnt || 1);
            const price = parseFloat(item.price || 0);
            const amount = quantity * price;
            const itemName = (item.title || 'Unknown Item').substring(0, 20); // Limit item name length

            html += `<div class="flex w-full text-xs">
                <div class="w-[10%]">${quantity}</div>
                <div class="w-[70%]">${itemName}</div>
                <div class="w-[20%] text-right">${amount.toFixed(2)}</div>
            </div>`;

            // Add variant information if present
            if (item.variantName) {
                html += `<div class="flex w-full text-xs pl-[10%]">
                    <div class="w-[70%] text-gray-600">+ ${item.variantName}</div>
                    <div class="w-[20%] text-right text-gray-600">+${(item.variantPrice || 0).toFixed(2)}</div>
                </div>`;
            }

            // Add add-ons if present
            if (item.addons && item.addons.length > 0) {
                item.addons.forEach(addon => {
                    html += `<div class="flex w-full text-xs pl-[10%]">
                        <div class="w-[70%] text-gray-600">+ ${addon.name}</div>
                        <div class="w-[20%] text-right text-gray-600">+${(addon.price || 0).toFixed(2)}</div>
                    </div>`;
                });
            }
        });

        html += '<div class="border-t border-dashed border-gray-400 mt-0.5"></div>';
        return html;
    }

    /**
     * Generate HTML for KOT items list
     * @param {Array} items - Order items
     * @returns {string} HTML for KOT items list
     * @private
     */
    _generateKOTItemsList(items) {
        let html = ``;

        items.forEach(item => {
            const quantity = parseFloat(item.quantity || item.qnt || 1);

            html += `<div class="flex text-xs">
                <div class="w-[10%] font-bold">${quantity}x</div>
                <div class="w-[90%] font-bold">${item.title || 'Unknown Item'}</div>
            </div>`;

            // Add variant information if present
            if (item.variantName) {
                html += `<div class="pl-5 text-xs text-gray-600">
                    Variant: ${item.variantName}
                </div>`;
            }

            // Add add-ons if present
            if (item.addons && item.addons.length > 0) {
                html += `<div class="pl-5 text-xs text-gray-600">
                    Add-ons: ${item.addons.map(addon => addon.name).join(', ')}
                </div>`;
            }

            if (item.instructions) {
                html += `<div class="pl-5 italic text-xs">
                    Note: ${item.instructions.trim()}
                </div>`;
            }
        });

        return html;
    }

    /**
     * Create default sections for bills
     * @param {Object} orderData - Order data for context-specific templates 
     * @returns {Array} Array of PrintSection instances
     * @private
     */
    _createDefaultBillSections(orderData = {}) {
        const sections = [];

        // Header section
        sections.push(new PrintSection({
            template: `${orderData.gstEnabled ? 'TAX INVOICE' : 'BILL/RECEIPT'}\n#businessName\n#address\nPhone: #phone\nWeb: #storeLink\nGST: #gstIN`,
            alignment: 'TextAlign.center',
            fontSize: 24,
            isBold: true
        }));

        // Order details section
        sections.push(new PrintSection({
            template: `Bill #: #billNo\nDate: #timestamp\nCustomer: #customerName\nPhone: #customerPhone\n${orderData.tableId ? `Table: ${orderData.tableId}` : ''}\nOrder from: #orderSource`,
            alignment: 'TextAlign.left',
            fontSize: 20,
            isBold: false
        }));

        // Items section - use itemsListText for printer commands
        sections.push(new PrintSection({
            template: '#itemsList',
            alignment: 'TextAlign.left',
            fontSize: 20,
            isBold: false
        }));

        // Totals section
        sections.push(new PrintSection({
            template: `Sub Total: #subtotal\n${orderData.discount && parseFloat(orderData.discount) > 0 ? 'Discount: #discount\n' : ''}#charges\nTOTAL: #total${orderData.taxUpdateInfo?.hashtag ? '\nTax ID: #bulkTaxHashtag' : ''}`,
            alignment: 'TextAlign.right',
            fontSize: 20,
            isBold: true
        }));

        // Payment section
        sections.push(new PrintSection({
            template: `Payment Mode: #payMode\n${orderData.notes ? orderData.notes : ''}`,
            alignment: 'TextAlign.left',
            fontSize: 20,
            isBold: false
        }));

        // Footer
        sections.push(new PrintSection({
            template: `Thank You!\nVisit Again\n#storeLink`,
            alignment: 'TextAlign.center',
            fontSize: 20,
            isBold: false
        }));

        return sections;
    }

    /**
     * Create default sections for KOT (Kitchen Order Ticket)
     * @param {Object} orderData - Order data for context-specific templates
     * @returns {Array} Array of PrintSection instances
     * @private
     */
    _createDefaultKOTSections(orderData = {}) {
        const sections = [];

        // Check if any items have originalQnt property (indicating quantity additions)
        const hasQuantityAdditions = orderData.items && orderData.items.some(item => item.originalQnt !== undefined);
        const kotTitle = orderData.isPartialKOT
            ? (hasQuantityAdditions ? 'KOT (ADDITIONS)' : 'KOT (NEW ITEMS)')
            : 'KOT';

        // Header section with indication if this is a partial KOT
        sections.push(new PrintSection({
            template: `${kotTitle}\n${orderData.tableId ? `TABLE ${orderData.tableId}` : ''}`,
            alignment: 'TextAlign.center',
            fontSize: 24,
            isBold: true
        }));

        // Order details section with item count indication if this is a partial KOT
        sections.push(new PrintSection({
            template: `KOT #: #billNo\nDate: #timestamp\n${orderData.isPartialKOT ? `ADDED ITEMS: ${orderData.newItemsCount} (Total: ${orderData.totalItemsCount})\n` : ''}Customer: #customerName\nPhone: #customerPhone\n${orderData.tableId ? `Table: ${orderData.tableId}` : ''}`,
            alignment: 'TextAlign.left',
            fontSize: 20,
            isBold: false
        }));

        // Items section - use kotItemsListText for printer commands
        sections.push(new PrintSection({
            template: '#kotItemsList',
            alignment: 'TextAlign.left',
            fontSize: 20,
            isBold: false
        }));

        // Special Instructions section (only if there are instructions)
        sections.push(new PrintSection({
            template: `#instructions`,
            alignment: 'TextAlign.left',
            fontSize: 20,
            isBold: false
        }));

        return sections;
    }

    /**
     * Opens a preview window showing both PNG and HTML renders of the receipt
     * @param {string} pngDataUrl - The PNG data URL of the rendered receipt
     * @param {HTMLElement} receiptContent - The HTML content of the receipt
     * @private
     */
    async _openPreviewWindow(pngDataUrl, receiptContent) {
        const previewWindow = window.open();
        previewWindow.document.write(`
            <html>
            <head>
                <title>Receipt Preview</title>
                <script src="https://cdn.tailwindcss.com"></script>
                <style>
                    body { display: flex; flex-direction: column; align-items: center; }
                    .preview-container { display: flex; gap: 20px; margin-top: 20px; }
                    .preview-section { border: 1px solid #ccc; padding: 10px; }
                </style>
            </head>
            <body>
                <h2>Receipt Preview</h2>
                <div class="preview-container">
                    <div class="preview-section">
                        <h3>PNG Render (Used for Printing)</h3>
                        <img src="${pngDataUrl}" alt="Receipt Preview">
                    </div>
                    <div class="preview-section">
                        <h3>HTML Render</h3>
                        <div style="border: 1px dashed #ccc;">
                            ${receiptContent.innerHTML}
                        </div>
                    </div>
                </div>
            </body>
            </html>
        `);
    }
}
