import { PrintTemplate, PrintSection } from './PrintTemplate.js';
import { sdk } from '../sdk.js';
import { UserSession } from './UserSession.js';
import { ModalManager } from '../components/ModalManager.js';


// BluetoothPrinting.js - Service for handling Bluetooth thermal printer connections
// This service uses Web Bluetooth API which is supported in Chrome and Edge, but not Safari or Firefox

// Import PrintTemplate classes (will be loaded via script tag in browser)
// The PrintTemplate.js file must be loaded before this file

/**
 * BluetoothPrinting provides methods to connect to and print to Bluetooth thermal printers
 * using Web Bluetooth API
 */
class BluetoothPrintingClass {
    constructor() {
        // Initialize printer sizes first
        this.printerSizes = {
            '2inch': 32,  // 2-inch thermal printer (32 characters)
            '3inch': 48,  // 3-inch thermal printer (48 characters)
            '4inch': 64   // 4-inch thermal printer (64 characters)
        };

        this.printer = null;
        this.connected = false;
        this.device = null;
        this.characteristic = null;
        this.encoder = new TextEncoder();

        // Initialize printer width after printerSizes is defined
        const size = this.getSavedPrinterWidth();
        this.printerWidth = size || this.printerSizes['3inch']; // Default to 48 characters (standard 3-inch)

        // Try to restore the last successful connection info from localStorage
        this.lastConnectedDevice = this.getSavedPrinter();

        // Initialize browser printing preference
        this.preferBrowserPrinting = this.getBrowserPrintingPreference();

        // Track attempts to auto-reconnect to prevent infinite loops
        this.reconnectAttempted = false;

        // Cache for loaded logo images
        this.imageCache = new Map();

        // Initialize managed printers list
        this.managedPrinters = this.getSavedPrinters() || [];

        // Initialize active printer selection - defaults to the most recently used printer
        this.activePrinterId = this.getActivePrinterId();

        // Make PrintTemplate and PrintSection classes accessible as properties
        // These should be available globally from PrintTemplate.js
        this.PrintTemplate = PrintTemplate;
        this.PrintSection = PrintSection;

        // Check if the classes are available
        if (!this.PrintTemplate || !this.PrintSection) {
            console.error("PrintTemplate.js must be loaded before BluetoothPrinting.js");
        }
    }

    /**
     * Initialize the BluetoothPrinting service and potentially restore connection
     * Call this method when the app starts
     */
    initialize() {
        console.log('Initializing BluetoothPrinting service');

        // Reset flags
        this.reconnectAttempted = false;

        // Attempt to silently reconnect if we have a saved printer and browser supports it
        if (this.isSupported() && this.lastConnectedDevice && !this.connected) {
            console.log('Attempting to restore printer connection on initialization');
            setTimeout(() => {
                this.attemptSilentReconnect()
                    .then(success => {
                        if (success) {
                            console.log('Successfully restored printer connection on initialization');
                            // Add event listeners for browser visibility changes
                            this._setupVisibilityListeners();
                        }
                    })
                    .catch(err => {
                        console.error('Failed to restore printer connection:', err);
                    });
            }, 1000); // Slight delay to ensure DOM is fully loaded
        }
    }

    /**
     * Print a KOT (Kitchen Order Ticket) for a specific order
     * This method handles all aspects of printing including connections and error handling
     * @param {string} orderId - The ID of the order to print
     * @param {string} [channel] - Optional order channel for printer selection
     * @returns {Promise<boolean>} True if printing was successful
     */
    async printKOT(orderId, channel = 'Default') {
        if (!orderId) {
            this._showToast("No order ID provided for KOT printing", "error");
            return false;
        }

        try {
            const result = await this._printReceipt(orderId, 'kot', null, false, channel);

            // If printing was successful and we had newly added items, clear their flags
            if (result && orderId) {
                const orderResult = await this.getOrderData(orderId);
                if (orderResult && orderResult.hasNewItems) {
                    const orderRef = sdk.db.collection("Orders").doc(orderId);
                    const updatedItems = orderResult.full.items.map(item => ({
                        ...item,
                        newlyAdded: false,  // Reset the flag after printing
                        newlyAddedQty: 0    // Reset the newly added quantity as well
                    }));

                    // Update the order with flags cleared
                    await orderRef.update({ items: updatedItems });
                    console.log("Cleared newlyAdded flags and quantities after KOT printing");
                }
            }

            return result;
        } catch (error) {
            console.error('Error in printKOT:', error);
            this._showToast(`Failed to print KOT: ${error.message}`, "error");
            return false;
        }
    }

    /**
     * Print a bill receipt for a specific order
     * This method handles all aspects of printing including connections and error handling
     * @param {string} orderId - The ID of the order to print
     * @param {string} [paymentMode] - Optional payment mode to include on the bill
     * @param {boolean} [autoPrint=false] - Whether to attempt auto-printing without dialog
     * @param {string} [channel] - Optional order channel for printer selection
     * @returns {Promise<boolean>} True if printing was successful
     */
    async printBill(orderId, paymentMode, autoPrint = false, channel = 'Default') {
        if (!orderId) {
            this._showToast("No order ID provided for bill printing", "error");
            return false;
        }

        try {
            return await this._printReceipt(orderId, 'bill', paymentMode, autoPrint, channel);
        } catch (error) {
            console.error('Error in printBill:', error);
            this._showToast(`Failed to print bill: ${error.message}`, "error");
            return false;
        }
    }

    /**
     * Shared printing function used by both printKOT and printBill
     * @param {string} orderId - The ID of the order to print
     * @param {string} type - The type of receipt ('kot' or 'bill')
     * @param {string} [paymentMode] - Optional payment mode for bills
     * @param {boolean} [autoPrint=false] - Whether to attempt auto-printing without dialog
     * @param {string} [channel] - Optional order channel for printer selection
     * @returns {Promise<boolean>} True if printing was successful
     * @private
     */
    async _printReceipt(orderId, type, paymentMode, autoPrint = false, channel = 'Default') {
        // Fetch order data
        const orderResult = await this.getOrderData(orderId);
        if (!orderResult) {
            this._showToast("Order not found", "error");
            return false;
        }

        // For KOT printing, use filtered data if we have newly added items
        // For bill printing, always use the full order data
        const orderData = (type === 'kot' && orderResult.hasNewItems)
            ? orderResult.filtered
            : orderResult.full;

        // Use order's channel if not provided
        if (!channel && orderData.priceVariant) {
            channel = orderData.priceVariant;
        }

        // Find the appropriate printer for this channel and receipt type
        const printer = this.getPrinterForChannel(channel, type);

        // Determine display name for receipt type
        const receiptName = type === 'kot' ? 'KOT' : 'bill';

        // Check if browser printing is preferred
        if (this.preferBrowserPrinting) {
            console.log('Using browser printing as preferred method');
            return await this._fallbackToBrowserPrinting(orderData, type, paymentMode, receiptName, autoPrint);
        }

        // Try Bluetooth printing first if supported
        if (this.isSupported()) {
            try {
                // Try printer-specific or default connection
                await this._connectToPrinter(printer, receiptName);

                // Get seller information and template
                const seller = UserSession?.seller || {};

                // Check if we have a custom template
                const hasCustomTemplate = seller.printTemplate &&
                    seller.printTemplate[type.toLowerCase()] &&
                    seller.printTemplate[type.toLowerCase()].sections &&
                    seller.printTemplate[type.toLowerCase()].sections.length > 0;

                // Get template data if available
                const templateData = hasCustomTemplate ? seller.printTemplate[type.toLowerCase()] : null;

                // Create print template directly
                const template = new this.PrintTemplate({
                    type: type,
                    orderData: orderData,
                    seller: seller,
                    templateData: templateData
                });

                // We're connected now, show a single printing message
                this._showToast(`Printing ${receiptName}...`, "info");

                // Generate printer commands directly from the template - AWAIT HERE
                const data = await template.toPrinterCommands();

                // Send to printer
                await this.sendData(data);
                this._showToast(`${receiptName} printed successfully`, "success");

                // Save the connected printer to the printer list
                this.savePrinter();

                return true;
            } catch (error) {
                // Handle printer error and try browser printing if appropriate
                const errorType = this._handlePrinterError(error);

                // If it's a user cancellation, don't attempt fallback
                if (errorType === "user_cancelled") {
                    return false;
                }

                // Try browser printing as fallback
                return await this._fallbackToBrowserPrinting(orderData, type, paymentMode, receiptName, autoPrint);
            }
        } else {
            // No Bluetooth support, use browser print directly
            return await this._fallbackToBrowserPrinting(orderData, type, paymentMode, receiptName, autoPrint);
        }
    }

    /**
     * Fallback to browser printing when Bluetooth printing fails
     * @param {Object} orderData - The order data
     * @param {string} type - The type of receipt ('kot' or 'bill')
     * @param {string} paymentMode - The payment mode
     * @param {string} receiptName - Name of receipt for user messages
     * @param {boolean} autoPrint - Whether to attempt auto-printing
     * @returns {Promise<boolean>} True if browser printing was successful
     * @private
     */
    async _fallbackToBrowserPrinting(orderData, type, paymentMode, receiptName, autoPrint) {
        this._showToast(`Attempting browser print for ${receiptName}...`, "info");
        try {
            // Get seller information
            const seller = UserSession?.seller || {};

            // Check if we have a custom template
            const hasCustomTemplate = seller.printTemplate &&
                seller.printTemplate[type.toLowerCase()] &&
                seller.printTemplate[type.toLowerCase()].sections &&
                seller.printTemplate[type.toLowerCase()].sections.length > 0;

            // Get template data if available
            const templateData = hasCustomTemplate ? seller.printTemplate[type.toLowerCase()] : null;

            // Generate HTML using PrintTemplate directly
            const template = new this.PrintTemplate({
                type: type,
                orderData: orderData,
                seller: seller,
                templateData: templateData
            });
            const receiptHtml = template.toHTML();

            // Always use autoPrint=true to ensure print dialog opens
            await this.browserPrint(receiptHtml, true);
            this._showToast(`${receiptName} printed successfully via browser`, "success");
            return true;
        } catch (fallbackErr) {
            console.error("Browser print fallback failed:", fallbackErr);
            this._showToast(`Browser print failed: ${fallbackErr.message}`, "error");
            return false;
        }
    }

    /**
     * Send raw data to the printer
     * @param {Uint8Array} data - ESC/POS command bytes to send to the printer
     */
    async sendData(data) {
        if (!this.connected || !this.characteristic) {
            throw new Error('Printer not connected. Call connect() first.');
        }

        // Log byte size
        console.log("Printer data size:", data.byteLength, "bytes");

        const MAX_RETRIES = 3;
        const RETRY_DELAY_MS = 300; // Increased retry delay
        const INTER_CHUNK_DELAY_MS = 20; // Increased delay between chunks
        const DEFAULT_CHUNK_SIZE = 200; // Smaller chunk size for better reliability

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                // Get the best chunk size, but don't exceed our default
                const maxSize = this.characteristic?.service?.device?.gatt?.server?.maxGATTCharacteristicWriteSize;
                const CHUNK_SIZE = maxSize ? Math.min(maxSize, DEFAULT_CHUNK_SIZE) : DEFAULT_CHUNK_SIZE;
                console.log("Max size:", maxSize, "Chunk size:", CHUNK_SIZE);

                // Break data into chunks and send with delays between chunks
                for (let i = 0; i < data.length; i += CHUNK_SIZE) {
                    const chunk = data.slice(i, i + CHUNK_SIZE);

                    // Choose write method based on characteristic properties
                    if (this.characteristic.properties.writeWithoutResponse) {
                        await this.characteristic.writeValueWithoutResponse(chunk);
                    } else {
                        await this.characteristic.writeValue(chunk);
                    }

                    // Add a delay between chunks to give the printer time to process
                    if (data.length > CHUNK_SIZE && i < data.length - CHUNK_SIZE) {
                        await new Promise(resolve => setTimeout(resolve, INTER_CHUNK_DELAY_MS));
                    }
                }

                console.log("Data transmission successful");
                return true;
            } catch (error) {
                console.warn(`Attempt ${attempt} to send data failed:`, error.message);

                if (attempt === MAX_RETRIES) {
                    console.error('Error sending data to printer after multiple retries:', error);
                    throw error; // Rethrow error after max retries
                }

                // Wait longer between retries
                console.log(`Retrying in ${RETRY_DELAY_MS * attempt}ms...`);
                await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * attempt));
            }
        }

        throw new Error('Failed to send data to printer after multiple retries.');
    }

    /**
     * Ensure printer is connected, trying silent reconnect first and then user-prompted connection if needed
     * @returns {Promise<boolean>} True if connection succeeded
     * @private
     */
    async ensurePrinterConnection() {
        if (!this.connected) {
            // First try silent reconnect if we have a saved printer
            const silentReconnected = await this.attemptSilentReconnect();

            // If silent reconnect fails, try regular connection with user interaction
            if (!silentReconnected) {
                try {
                    // Check if we have a saved printer to suggest
                    if (this.lastConnectedDevice) {
                        console.log(`Attempting to reconnect to last used printer: ${this.lastConnectedDevice.name}`);
                        // No toast notification here - let the calling method handle user-facing notifications
                    }

                    await this.connect();
                } catch (connectError) {
                    // Handle user cancellation with a specific error
                    if (connectError.message.includes("Device selection cancelled") ||
                        connectError.message.includes("cancelled by user")) {
                        throw new Error("Printing cancelled: No printer selected");
                    }
                    // Handle unsupported device errors with a friendly message
                    if (connectError.name === 'NetworkError' ||
                        connectError.message.includes('not supported as a printer') ||
                        connectError.message.includes('Unsupported device')) {
                        throw new Error("This device cannot be used for printing. Please select a compatible Bluetooth printer.");
                    }
                    throw connectError;
                }
            } else {
                console.log('Successfully reconnected to printer silently!');
                // Reset reconnect attempt flag since we had a successful connection
                this.reconnectAttempted = false;
            }
        } else {
            console.log('Printer already connected, no reconnection needed');
        }
        return true;
    }

    /**
     * Fetch order data from Firestore
     * @param {string} orderId - The ID of the order to fetch
     * @returns {Promise<Object>} The order data
     * @private
     */
    async getOrderData(orderId) {
        const orderRef = sdk.db.collection("Orders").doc(orderId);
        const orderDoc = await orderRef.get();
        const orderData = orderDoc.data();

        if (!orderData) {
            throw new Error("Order not found");
        }

        // Ensure we have the most up-to-date data
        console.log("Order data for printing:", {
            orderId,
            hasCustomer: !!orderData.custName || !!orderData.customer,
            customerName: orderData.custName || (orderData.customer ? orderData.customer.name : null),
            customerPhone: orderData.custPhone || (orderData.customer ? orderData.customer.phone : null)
        });

        // Check if there are any newly added items
        const hasNewlyAddedItems = orderData.items &&
            orderData.items.some(item => item.newlyAdded === true);

        if (hasNewlyAddedItems) {
            // Create a filtered version with only newly added items
            const newlyAddedItems = orderData.items.filter(item => item.newlyAdded === true);

            // Process the newly added items to show only the newly added quantities
            const processedItems = newlyAddedItems.map(item => {
                // If we have a specific newly added quantity, use that
                if (item.newlyAddedQty && item.newlyAddedQty > 0) {
                    console.log(`KOT: Item ${item.title} has newlyAddedQty=${item.newlyAddedQty}, original qnt=${item.qnt}`);
                    return {
                        ...item,
                        qnt: item.newlyAddedQty, // Use only the newly added quantity for KOT
                        originalQnt: item.qnt // Keep track of the original quantity
                    };
                }
                console.log(`KOT: Item ${item.title} has no newlyAddedQty, using full quantity ${item.qnt}`);
                return item; // Otherwise keep the item as is
            });

            // Clone the order data to avoid modifying the original
            const filteredOrder = JSON.parse(JSON.stringify(orderData));

            // Add metadata about the filtered items
            filteredOrder.isPartialKOT = true;
            filteredOrder.newItemsCount = newlyAddedItems.length;
            filteredOrder.totalItemsCount = orderData.items.length;

            // Replace items with only the newly added ones (with adjusted quantities)
            filteredOrder.items = processedItems;

            // Return both full and filtered versions
            return {
                full: orderData,
                filtered: filteredOrder,
                hasNewItems: true
            };
        }

        // If no newly added items, return the full order data
        return {
            full: orderData,
            filtered: orderData,
            hasNewItems: false
        };
    }

    /**
     * Get list of saved printers
     * @returns {Array} List of saved printers
     */
    getSavedPrinters() {
        try {
            const savedPrinters = localStorage.getItem('managedPrinters');
            if (savedPrinters) {
                return JSON.parse(savedPrinters);
            }
        } catch (error) {
            console.error('Error retrieving saved printers:', error);
        }
        return [];
    }

    /**
     * Save the list of managed printers
     * @param {Array} printers - The printers to save
     * @private
     */
    savePrinters(printers) {
        try {
            localStorage.setItem('managedPrinters', JSON.stringify(printers));
            this.managedPrinters = printers;
        } catch (error) {
            console.error('Error saving printers:', error);
        }
    }

    /**
     * Get the active printer ID
     * @returns {string|null} The active printer ID or null if none
     */
    getActivePrinterId() {
        try {
            return localStorage.getItem('activePrinterId') || null;
        } catch (error) {
            console.error('Error retrieving active printer ID:', error);
            return null;
        }
    }

    /**
     * Set the active printer ID
     * @param {string} printerId - The ID of the printer to set as active
     */
    setActivePrinterId(printerId) {
        try {
            localStorage.setItem('activePrinterId', printerId);
            this.activePrinterId = printerId;
        } catch (error) {
            console.error('Error saving active printer ID:', error);
        }
    }

    /**
     * Add a printer to the managed printers list
     * @param {Object} printer - The printer to add
     * @param {boolean} setAsDefault - Whether to set this printer as the default
     * @returns {Object} The added printer with generated ID
     */
    addPrinter(printer, setAsDefault = false) {
        try {
            const printers = this.getSavedPrinters();

            // Generate a unique ID if none provided
            const newPrinter = {
                ...printer,
                id: printer.id || `printer_${Date.now()}`,
                isDefault: setAsDefault
            };

            // If this is marked as default, unmark any existing default
            if (setAsDefault) {
                printers.forEach(p => p.isDefault = false);
            }

            // Add the new printer
            printers.push(newPrinter);

            // Save the updated list
            this.savePrinters(printers);

            // If this is the first printer or default, set it as active
            if (setAsDefault || printers.length === 1) {
                this.setActivePrinterId(newPrinter.id);
            }

            return newPrinter;
        } catch (error) {
            console.error('Error adding printer:', error);
            throw error;
        }
    }

    /**
     * Update a printer's properties
     * @param {string} printerId - The ID of the printer to update
     * @param {Object} updates - The properties to update
     * @returns {Object|null} The updated printer or null if not found
     */
    updatePrinter(printerId, updates) {
        try {
            const printers = this.getSavedPrinters();
            const index = printers.findIndex(p => p.id === printerId);

            if (index === -1) {
                console.error(`Printer with ID ${printerId} not found`);
                return null;
            }

            // If setting this as default, unmark others
            if (updates.isDefault) {
                printers.forEach(p => p.isDefault = false);
            }

            // Update the printer
            printers[index] = {
                ...printers[index],
                ...updates
            };

            // Save the updated list
            this.savePrinters(printers);

            return printers[index];
        } catch (error) {
            console.error('Error updating printer:', error);
            throw error;
        }
    }

    /**
     * Remove a printer from the managed printers list
     * @param {string} printerId - The ID of the printer to remove
     * @returns {boolean} True if successful, false otherwise
     */
    removePrinter(printerId) {
        try {
            let printers = this.getSavedPrinters();
            const removedPrinter = printers.find(p => p.id === printerId);

            if (!removedPrinter) {
                return false;
            }

            // Remove the printer
            printers = printers.filter(p => p.id !== printerId);

            // If we removed the default printer, set a new default if possible
            if (removedPrinter.isDefault && printers.length > 0) {
                printers[0].isDefault = true;
            }

            // If we removed the active printer, set a new active if possible
            if (this.activePrinterId === printerId && printers.length > 0) {
                this.setActivePrinterId(printers[0].id);
            } else if (printers.length === 0) {
                this.setActivePrinterId(null);
            }

            // Save the updated list
            this.savePrinters(printers);

            return true;
        } catch (error) {
            console.error('Error removing printer:', error);
            throw error;
        }
    }

    /**
     * Get the appropriate printer for a given order channel and print type
     * @param {string} channel - The order channel ('Default', 'Swiggy', etc.)
     * @param {string} printType - The print type ('kot' or 'bill')
     * @returns {Object|null} The printer to use or null if none found
     */
    getPrinterForChannel(channel, printType) {
        const printers = this.getSavedPrinters();

        if (printers.length === 0) {
            return null;
        }

        // First, look for a printer specifically assigned to this channel and print type
        let printer = printers.find(p =>
            p.assignments &&
            p.assignments.some(a =>
                a.channel === channel &&
                (a.printType === printType || a.printType === 'all')
            )
        );

        // If none found, try to find a printer assigned to "All Channels" with this print type
        if (!printer) {
            printer = printers.find(p =>
                p.assignments &&
                p.assignments.some(a =>
                    a.channel === 'All Channels' &&
                    (a.printType === printType || a.printType === 'all')
                )
            );
        }

        // If still none found, use the default printer
        if (!printer) {
            printer = printers.find(p => p.isDefault);
        }

        // If still none found, use the first available printer
        if (!printer && printers.length > 0) {
            printer = printers[0];
        }

        return printer;
    }

    /**
     * Helper method to show toast notifications via ModalManager or fallback function
     * @param {string} message - The message to show
     * @param {string} [type='info'] - The type of toast (success, error, warning, info)
     * @private
     */
    _showToast(message, type = 'info') {
        if (ModalManager && typeof ModalManager.showToast === 'function') {
            ModalManager.showToast(message, { type });
        } else if (typeof showToast === 'function') {
            showToast(message, type);
        } else {
            console.log(`[Toast ${type}]: ${message}`);
        }
    }

    /**
     * Handle printer connection errors with appropriate user feedback
     * @param {Error} error - The error to handle
     * @param {boolean} [showToasts=true] - Whether to show toast notifications
     * @returns {string} - Classification of the error
     * @private
     */
    _handlePrinterError(error, showToasts = true) {
        console.error('Printer error:', error);

        // User cancelled the connection
        if (error.message?.includes("cancelled") ||
            error.message?.includes("No printer selected") ||
            error.name === "NotFoundError") {
            if (showToasts) {
                this._showToast("Printing cancelled by user", "info");
            }
            return "user_cancelled";
        }

        // Incompatible device errors
        if (error.message?.includes("No suitable service") ||
            error.message?.includes("No services found") ||
            error.message?.includes("not supported as a printer") ||
            error.message?.includes("cannot be used for printing") ||
            (error.name === 'NetworkError' && error.message?.includes("Unsupported device"))) {
            if (showToasts) {
                this._showToast("Could not connect to printer. Please select a compatible thermal printer.", "error");
            }
            return "incompatible_device";
        }

        // Generic connection errors
        if (error.name === "NetworkError" ||
            error.message?.includes("disconnected") ||
            error.message?.includes("connection") ||
            error.message?.includes("GATT")) {
            if (showToasts) {
                this._showToast(`Printer connection error: ${error.message}`, "error");
            }
            return "connection_error";
        }

        // Generic errors
        if (showToasts) {
            this._showToast(`Printing error: ${error.message}`, "error");
        }
        return "other_error";
    }

    /**
     * Set the printer width configuration
     * @param {string} size - The printer size ('2inch', '3inch', '4inch')
     */
    setPrinterSize(size) {
        if (this.printerSizes && this.printerSizes[size]) {
            // Update the instance property with the numeric value
            this.printerWidth = this.printerSizes[size];
            // Save the size identifier to localStorage
            this.savePrinterWidth(size);
            console.log(`Printer size set to ${size} (${this.printerWidth} characters)`);
        } else {
            console.error('Invalid printer size. Supported sizes are: 2inch, 3inch, 4inch');
            throw new Error('Invalid printer size. Supported sizes are: 2inch, 3inch, 4inch');
        }
    }

    /**
     * Open a browser print dialog with the provided HTML content
     * This is used as a fallback when Bluetooth printing is not available
     * @param {string} html - The HTML content to print
     * @param {boolean} autoPrint - Whether to automatically trigger the print dialog
     * @returns {Promise<boolean>} True if the print dialog was opened successfully
     */
    async browserPrint(html, autoPrint = true) {
        return new Promise((resolve, reject) => {
            try {
                // Create a hidden iframe for printing instead of opening a new window
                const iframe = document.createElement('iframe');
                iframe.style.position = 'fixed';
                iframe.style.right = '0';
                iframe.style.bottom = '0';
                iframe.style.width = '0';
                iframe.style.height = '0';
                iframe.style.border = '0';

                // Add the iframe to the document
                document.body.appendChild(iframe);

                // Write content to the iframe
                const doc = iframe.contentWindow.document;
                doc.open();
                doc.write(html);
                doc.close();

                // Wait for resources to load then print
                iframe.onload = () => {
                    // Trigger print dialog
                    iframe.contentWindow.print();

                    // Resolve after print dialog is shown
                    resolve(true);

                    // Remove the iframe after printing
                    setTimeout(() => {
                        document.body.removeChild(iframe);
                    }, 500);
                };

                // Set a timeout in case onload doesn't fire
                setTimeout(() => {
                    if (document.body.contains(iframe)) {
                        iframe.contentWindow.print();
                        resolve(true);

                        // Remove the iframe after printing
                        setTimeout(() => {
                            if (document.body.contains(iframe)) {
                                document.body.removeChild(iframe);
                            }
                        }, 500);
                    }
                }, 1000);
            } catch (error) {
                console.error('Browser print error:', error);
                reject(error);
            }
        });
    }

    /**
     * Save the printer width configuration to localStorage
     * @private
     */
    savePrinterWidth(size) {
        try {
            localStorage.setItem('printerWidth', size);
        } catch (error) {
            console.error('Error saving printer width:', error);
        }
    }

    /**
     * Get saved printer width from localStorage
     * @returns {number} The saved printer width in characters
     * @private
     */
    getSavedPrinterWidth() {
        try {
            // Ensure printerSizes is initialized
            if (!this.printerSizes) {
                return 48; // Default to 3-inch (48 characters)
            }

            const size = localStorage.getItem('printerWidth');
            // If size exists and it's a valid key in printerSizes, return the numeric value
            if (size && this.printerSizes[size]) {
                return this.printerSizes[size];
            }

            // Default to 3-inch (48 characters)
            return this.printerSizes['3inch'];
        } catch (error) {
            console.error('Error retrieving saved printer width:', error);
            // Ensure safe fallback even if this.printerSizes is undefined
            return 48; // Default to 3-inch (48 characters)
        }
    }

    /**
     * Check if Web Bluetooth is supported by the browser
     */
    isSupported() {
        return !!navigator.bluetooth;
    }

    /**
     * Save the current printer details to localStorage
     * @private
     */
    savePrinter() {
        if (!this.device) return;

        try {
            const printerInfo = {
                id: this.device.id,
                name: this.device.name || 'Unknown Printer'
            };

            localStorage.setItem('lastConnectedPrinter', JSON.stringify(printerInfo));
            this.lastConnectedDevice = printerInfo;
            console.log('Printer information saved:', printerInfo);

            // Add the printer to the managed printers list if not already there
            const printers = this.getSavedPrinters();
            const existingPrinter = printers.find(p => p.deviceId === this.device.id);

            if (!existingPrinter) {
                // Create a new printer entry for managed printers
                const newPrinter = {
                    id: `printer_${Date.now()}`,
                    name: this.device.name || 'Printer',
                    deviceId: this.device.id,
                    deviceName: this.device.name || 'Unknown Printer',
                    dateAdded: new Date().toISOString(),
                    lastConnected: new Date().toISOString()
                };

                // Add to managed printers
                printers.push(newPrinter);
                this.savePrinters(printers);
                console.log('Added printer to managed printers list:', newPrinter);
            } else {
                // Update the last connected timestamp
                existingPrinter.lastConnected = new Date().toISOString();
                this.savePrinters(printers);
                console.log('Updated printer last connected timestamp:', existingPrinter);
            }
        } catch (error) {
            console.error('Error saving printer information:', error);
        }
    }

    /**
     * Get saved printer details from localStorage
     * @returns {Object|null} The saved printer info or null if none exists
     */
    getSavedPrinter() {
        try {
            const savedPrinter = localStorage.getItem('lastConnectedPrinter');
            if (savedPrinter) {
                return JSON.parse(savedPrinter);
            }
        } catch (error) {
            console.error('Error retrieving saved printer:', error);
        }
        return null;
    }

    /**
     * Clear saved printer from localStorage
     */
    clearSavedPrinter() {
        try {
            localStorage.removeItem('lastConnectedPrinter');
            this.lastConnectedDevice = null;
        } catch (error) {
            console.error('Error clearing saved printer:', error);
        }
    }

    /**
     * Attempt to silently reconnect to the last used printer without UI interaction
     * This is called internally when a print operation is requested and we're not connected
     * @returns {Promise<boolean>} True if reconnection was successful
     * @private
     */
    async attemptSilentReconnect() {
        if (!this.isSupported() || !this.lastConnectedDevice || this.reconnectAttempted) {
            return false;
        }

        console.log('Attempting silent reconnect to saved printer:', this.lastConnectedDevice.name);
        this.reconnectAttempted = true;

        try {
            // Try to get the device by name
            this.device = await navigator.bluetooth.requestDevice({
                filters: [{
                    name: this.lastConnectedDevice.name
                }],
                optionalServices: [
                    '000018f0-0000-1000-8000-00805f9b34fb',  // Common printer service
                    '00001101-0000-1000-8000-00805f9b34fb',  // Serial Port Profile
                    '00001800-0000-1000-8000-00805f9b34fb',  // Generic Access Service
                    '00001801-0000-1000-8000-00805f9b34fb',  // Generic Attribute Service
                    '0000180a-0000-1000-8000-00805f9b34fb',  // Device Information Service
                    '0000ffff-0000-1000-8000-00805f9b34fb',  // Vendor specific service
                    '0000fff0-0000-1000-8000-00805f9b34fb',  // Vendor specific service
                    '0000ff00-0000-1000-8000-00805f9b34fb',  // Vendor specific service
                    '0000fe00-0000-1000-8000-00805f9b34fb',  // Vendor specific service
                    '00010000-0000-1000-8000-00805f9b34fb',  // Vendor specific service
                    '00000000-0000-1000-8000-00805f9b34fb'   // Vendor specific service
                ]
            });

            // Connect to GATT server
            const server = await this.device.gatt.connect();
            console.log('Silent reconnect: Connected to GATT server');

            // Get all services
            const services = await server.getPrimaryServices();
            console.log(`Found ${services.length} services`);

            // Try to find a writable characteristic in any of the services
            let service;
            let characteristic;

            // Try each service to find a writable characteristic
            for (const s of services) {
                try {
                    console.log(`Exploring service ${s.uuid}...`);
                    const chars = await s.getCharacteristics();
                    console.log(`Found ${chars.length} characteristics in service ${s.uuid}`);

                    // Find a writable characteristic
                    const writableChar = chars.find(c =>
                        c.properties.write || c.properties.writeWithoutResponse
                    );

                    if (writableChar) {
                        service = s;
                        characteristic = writableChar;
                        break;
                    }
                } catch (e) {
                    console.log(`Error exploring service ${s.uuid}:`, e);
                }
            }

            if (!service || !characteristic) {
                console.log('No suitable characteristic found during silent reconnect');
                return false;
            }

            console.log('Silent reconnect: Using service:', service.uuid);
            console.log('Silent reconnect: Using characteristic:', characteristic.uuid);

            this.characteristic = characteristic;
            this.connected = true;

            // Set up disconnection listener to reset state
            this.device.addEventListener('gattserverdisconnected', () => {
                console.log('Bluetooth device disconnected');
                this.connected = false;
                this.characteristic = null;
            });

            console.log('Silent reconnect successful');
            return true;
        } catch (err) {
            console.log('Silent reconnect failed:', err);
            // Use _handlePrinterError with showToasts=false to avoid showing notifications
            this._handlePrinterError(err, false);
            this.reconnectAttempted = false; // Reset so we can try again if needed
            return false;
        }
    }

    /**
     * Shows a modal to connect to a printer
     * @returns {Promise} Resolves when printer is selected or rejects if cancelled
     */
    async showPrinterConnectionModal() {
        return new Promise((resolve, reject) => {
            // If ModalManager is available, use it to create a modal
            if (ModalManager && typeof ModalManager.createCenterModal === 'function') {
                const hasSavedPrinter = !!this.lastConnectedDevice;

                const modalContent = `
                    <div class="py-2">
                        <div class="flex items-center justify-center mb-4">
                            <i class="ph ph-printer text-red-500 text-3xl"></i>
                        </div>
                        
                        ${hasSavedPrinter ? `
                            <div class="mb-4 bg-gray-50 p-3 rounded-lg">
                                <div class="font-medium text-gray-800 mb-1">Last Connected Printer</div>
                                <div class="flex items-center">
                                    <i class="ph ph-printer text-gray-500 mr-2"></i>
                                    <span>${this.lastConnectedDevice.name}</span>
                                </div>
                            </div>
                        ` : ''}
                        
                        <div class="space-y-3">
                            ${hasSavedPrinter ? `
                                <button id="use-saved-printer" class="w-full py-2.5 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors flex items-center justify-center">
                                    <i class="ph ph-printer mr-2"></i>
                                    Use Last Connected Printer
                                </button>
                            ` : ''}
                            
                            <button id="select-new-printer" class="w-full py-2.5 ${hasSavedPrinter ? 'bg-gray-100 text-gray-800 hover:bg-gray-200' : 'bg-red-500 text-white hover:bg-red-600'} rounded-lg transition-colors flex items-center justify-center">
                                <i class="ph ph-${hasSavedPrinter ? 'plus-circle' : 'printer'} mr-2"></i>
                                ${hasSavedPrinter ? 'Select Different Printer' : 'Select Printer'}
                            </button>
                            
                            <button id="use-browser-print" class="w-full py-2.5 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors flex items-center justify-center">
                                <i class="ph ph-browser mr-2"></i>
                                Use Browser Print
                            </button>
                            
                            <button id="cancel-printer-select" class="w-full py-2.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors">
                                Cancel
                            </button>
                        </div>
                    </div>
                `;

                const modal = ModalManager.createCenterModal({
                    id: 'printer-connection-modal',
                    title: 'Connect to Printer',
                    content: modalContent,
                    onShown: (modalControl) => {
                        // Handle using saved printer
                        const useSavedPrinterBtn = document.getElementById('use-saved-printer');
                        if (useSavedPrinterBtn) {
                            useSavedPrinterBtn.addEventListener('click', () => {
                                modalControl.close();
                                resolve('use-saved');
                            });
                        }

                        // Handle selecting new printer
                        const selectNewPrinterBtn = document.getElementById('select-new-printer');
                        if (selectNewPrinterBtn) {
                            selectNewPrinterBtn.addEventListener('click', () => {
                                modalControl.close();
                                resolve('select-new');
                            });
                        }

                        // Handle browser printing
                        const useBrowserPrintBtn = document.getElementById('use-browser-print');
                        if (useBrowserPrintBtn) {
                            useBrowserPrintBtn.addEventListener('click', () => {
                                modalControl.close();
                                resolve('use-browser');
                            });
                        }

                        // Handle cancel
                        const cancelBtn = document.getElementById('cancel-printer-select');
                        if (cancelBtn) {
                            cancelBtn.addEventListener('click', () => {
                                modalControl.close();
                                reject(new Error('Device selection cancelled by user'));
                            });
                        }
                    }
                });
            } else {
                // If ModalManager is not available, go straight to selecting a new printer
                const options = ['Use last connected printer', 'Select new printer', 'Use browser print', 'Cancel'];
                const selectedOption = this.lastConnectedDevice ?
                    prompt(`Select an option:\n1. Use last connected printer: ${this.lastConnectedDevice.name}\n2. Select new printer\n3. Use browser print\n4. Cancel`, '1') :
                    prompt(`Select an option:\n1. Select printer\n2. Use browser print\n3. Cancel`, '1');

                if (selectedOption === '1') {
                    if (this.lastConnectedDevice) {
                        resolve('use-saved');
                    } else {
                        resolve('select-new');
                    }
                } else if (selectedOption === '2') {
                    if (this.lastConnectedDevice) {
                        resolve('select-new');
                    } else {
                        resolve('use-browser');
                    }
                } else if (selectedOption === '3') {
                    if (this.lastConnectedDevice) {
                        resolve('use-browser');
                    } else {
                        reject(new Error('Device selection cancelled by user'));
                    }
                } else {
                    reject(new Error('Device selection cancelled by user'));
                }
            }
        });
    }

    /**
     * Shows a modal to select printer size
     */
    async showPrinterSizeModal() {
        return new Promise((resolve, reject) => {
            if (ModalManager && typeof ModalManager.createCenterModal === 'function') {
                // Get current size for highlighting the active button
                const currentSize = localStorage.getItem('printerWidth') || '3inch';

                const modalContent = `
                    <div class="py-2">
                        <div class="flex items-center justify-center mb-4">
                            <i class="ph ph-printer text-red-500 text-3xl"></i>
                        </div>
                        
                        <div class="mb-4">
                            <h3 class="text-gray-800 font-medium mb-2">Select Printer Size</h3>
                            <p class="text-gray-600 text-sm">Choose your printer's paper width for optimal formatting</p>
                        </div>
                        
                        <div class="space-y-3">
                            <button id="size-2inch" class="w-full py-2.5 ${currentSize === '2inch' ? 'bg-red-500 text-white hover:bg-red-600' : 'bg-gray-100 text-gray-800 hover:bg-gray-200'} rounded-lg transition-colors flex items-center justify-center gap-2">
                                <i class="ph ph-printer"></i>
                                2-inch (32 characters)
                            </button>
                            
                            <button id="size-3inch" class="w-full py-2.5 ${currentSize === '3inch' ? 'bg-red-500 text-white hover:bg-red-600' : 'bg-gray-100 text-gray-800 hover:bg-gray-200'} rounded-lg transition-colors flex items-center justify-center gap-2">
                                <i class="ph ph-printer"></i>
                                3-inch (48 characters)
                            </button>
                            
                            <button id="size-4inch" class="w-full py-2.5 ${currentSize === '4inch' ? 'bg-red-500 text-white hover:bg-red-600' : 'bg-gray-100 text-gray-800 hover:bg-gray-200'} rounded-lg transition-colors flex items-center justify-center gap-2">
                                <i class="ph ph-printer"></i>
                                4-inch (64 characters)
                            </button>
                        </div>
                    </div>
                `;

                const modal = ModalManager.createCenterModal({
                    id: 'printer-size-modal',
                    title: 'Printer Configuration',
                    content: modalContent,
                    onShown: (modalControl) => {
                        const handle2Inch = document.getElementById('size-2inch');
                        const handle3Inch = document.getElementById('size-3inch');
                        const handle4Inch = document.getElementById('size-4inch');

                        const handleSizeSelection = (size) => {
                            this.setPrinterSize(size); // Set size before closing modal
                            modalControl.close();
                            resolve(size);
                        };

                        if (handle2Inch) {
                            handle2Inch.addEventListener('click', () => handleSizeSelection('2inch'));
                        }

                        if (handle3Inch) {
                            handle3Inch.addEventListener('click', () => handleSizeSelection('3inch'));
                        }

                        if (handle4Inch) {
                            handle4Inch.addEventListener('click', () => handleSizeSelection('4inch'));
                        }
                    }
                });
            } else {
                // Fallback to simple prompt if ModalManager is not available
                const size = prompt('Select printer size (2inch, 3inch, 4inch):', '3inch');
                if (size && ['2inch', '3inch', '4inch'].includes(size)) {
                    this.setPrinterSize(size); // Set size before resolving
                    resolve(size);
                } else {
                    this.setPrinterSize('3inch'); // Set default size
                    resolve('3inch'); // Default to 3-inch if invalid or cancelled
                }
            }
        });
    }

    /**
     * Connect to a Bluetooth printer device
     * Must be called from a user gesture (like a button click)
     */
    async connect() {
        if (!this.isSupported()) {
            throw new Error('Web Bluetooth is not supported in this browser. Please use Chrome or Edge.');
        }

        // Check Bluetooth availability
        if (typeof navigator.bluetooth.getAvailability === 'function') {
            try {
                const isBluetoothAvailable = await navigator.bluetooth.getAvailability();
                if (!isBluetoothAvailable) {
                    console.error("Bluetooth adapter is not available. Please ensure Bluetooth is turned on in your system settings and that your browser has permission to access it.");
                    throw new Error('Bluetooth is not available on this device. Please turn on Bluetooth and grant browser permissions.');
                }
            } catch (availabilityError) {
                console.error("Error checking Bluetooth availability:", availabilityError);
                // We can still proceed, as getAvailability might not be supported or might fail for other reasons,
                // but requestDevice will ultimately determine usability.
            }
        }

        // If already connected, show size modal and return
        if (this.connected && this.device && this.characteristic) {
            await this.showPrinterSizeModal();
            return true;
        }

        try {
            // Show connection modal and handle printer selection
            let action;
            try {
                action = await this.showPrinterConnectionModal();
            } catch (modalError) {
                throw modalError; // User cancelled from the modal
            }

            // Handle browser print option
            if (action === 'use-browser') {
                console.log('User selected browser printing option');
                // Set a flag to indicate browser printing preference
                this.preferBrowserPrinting = true;
                // Save this preference
                this.saveBrowserPrintingPreference(true);
                // Show toast to confirm selection
                this._showToast('Browser printing selected', 'info');
                // Return true to indicate successful "connection" (in this case, selection of browser printing)
                return true;
            }

            // Handle different user actions
            if (action === 'use-saved' && this.lastConnectedDevice) {
                // Reset browser printing preference when selecting a Bluetooth printer
                if (this.preferBrowserPrinting) {
                    this.preferBrowserPrinting = false;
                    this.saveBrowserPrintingPreference(false);
                }

                try {
                    console.info(`Attempting to reconnect to saved printer: ${this.lastConnectedDevice.name}. Ensure it's ON and discoverable.`);
                    this.device = await navigator.bluetooth.requestDevice({
                        filters: [{
                            name: this.lastConnectedDevice.name
                        }],
                        // Include all possible printer-related services as optional
                        optionalServices: [
                            '000018f0-0000-1000-8000-00805f9b34fb',  // Common printer service
                            '00001101-0000-1000-8000-00805f9b34fb',  // Serial Port Profile
                            '00001800-0000-1000-8000-00805f9b34fb',  // Generic Access Service
                            '00001801-0000-1000-8000-00805f9b34fb',  // Generic Attribute Service
                            '0000180a-0000-1000-8000-00805f9b34fb',  // Device Information Service
                            '0000ffff-0000-1000-8000-00805f9b34fb',  // Vendor specific service
                            '0000fff0-0000-1000-8000-00805f9b34fb',  // Vendor specific service
                            '0000ff00-0000-1000-8000-00805f9b34fb',  // Vendor specific service
                            '0000fe00-0000-1000-8000-00805f9b34fb',  // Vendor specific service
                            '00010000-0000-1000-8000-00805f9b34fb',  // Vendor specific service
                            '00000000-0000-1000-8000-00805f9b34fb'   // Vendor specific service
                        ]
                    });
                } catch (reconnectError) {
                    console.warn('Error reconnecting to saved printer, falling back to new device selection:', reconnectError.message);
                    // Fallback to regular device selection if reconnection fails
                    console.info("Attempting to select a new printer. Please ensure your Bluetooth printer is ON, in PAIRING/DISCOVERABLE mode, and close to your computer. Also, ensure Bluetooth is enabled on your computer and this website has Bluetooth permissions.");
                    try {
                        this.device = await navigator.bluetooth.requestDevice({
                            acceptAllDevices: true,
                            optionalServices: [
                                '000018f0-0000-1000-8000-00805f9b34fb',  // Common printer service
                                '00001101-0000-1000-8000-00805f9b34fb',  // Serial Port Profile
                                '00001800-0000-1000-8000-00805f9b34fb',  // Generic Access Service
                                '00001801-0000-1000-8000-00805f9b34fb',  // Generic Attribute Service
                                '0000180a-0000-1000-8000-00805f9b34fb',  // Device Information Service
                                '0000ffff-0000-1000-8000-00805f9b34fb',  // Vendor specific service
                                '0000fff0-0000-1000-8000-00805f9b34fb',  // Vendor specific service
                                '0000ff00-0000-1000-8000-00805f9b34fb',  // Vendor specific service
                                '0000fe00-0000-1000-8000-00805f9b34fb',  // Vendor specific service
                                '00010000-0000-1000-8000-00805f9b34fb',  // Vendor specific service
                                '00000000-0000-1000-8000-00805f9b34fb'   // Vendor specific service
                            ]
                        });
                    } catch (deviceSelectError) {
                        console.error('Error during printer selection (fallback from saved):', deviceSelectError);
                        if (deviceSelectError.name === "NotFoundError") {
                            throw new Error('Printer selection cancelled or no compatible devices found. Ensure printer is discoverable and try again.');
                        } else if (deviceSelectError.name === "SecurityError") {
                            throw new Error('Bluetooth permission denied. Please allow Bluetooth access for this site in your browser settings.');
                        }
                        throw new Error(`Printer selection failed: ${deviceSelectError.message}. Check Bluetooth settings and printer discoverability.`);
                    }
                }
            } else if (action === 'select-new') {
                // Reset browser printing preference when selecting a new Bluetooth printer
                if (this.preferBrowserPrinting) {
                    this.preferBrowserPrinting = false;
                    this.saveBrowserPrintingPreference(false);
                }

                console.info("Attempting to select a new printer. Please ensure your Bluetooth printer is ON, in PAIRING/DISCOVERABLE mode, and close to your computer. Also, ensure Bluetooth is enabled on your computer and this website has Bluetooth permissions.");
                try {
                    this.device = await navigator.bluetooth.requestDevice({
                        acceptAllDevices: true,
                        optionalServices: [
                            '000018f0-0000-1000-8000-00805f9b34fb',  // Common printer service
                            '00001101-0000-1000-8000-00805f9b34fb',  // Serial Port Profile
                            '00001800-0000-1000-8000-00805f9b34fb',  // Generic Access Service
                            '00001801-0000-1000-8000-00805f9b34fb',  // Generic Attribute Service
                            '0000180a-0000-1000-8000-00805f9b34fb',  // Device Information Service
                            '0000ffff-0000-1000-8000-00805f9b34fb',  // Vendor specific service
                            '0000fff0-0000-1000-8000-00805f9b34fb',  // Vendor specific service
                            '0000ff00-0000-1000-8000-00805f9b34fb',  // Vendor specific service
                            '0000fe00-0000-1000-8000-00805f9b34fb',  // Vendor specific service
                            '00010000-0000-1000-8000-00805f9b34fb',  // Vendor specific service
                            '00000000-0000-1000-8000-00805f9b34fb'   // Vendor specific service
                        ]
                    });
                } catch (deviceSelectError) {
                    console.error('Error during new printer selection:', deviceSelectError);
                    if (deviceSelectError.name === "NotFoundError") {
                        throw new Error('Printer selection cancelled or no compatible devices found. Ensure printer is discoverable and try again.');
                    } else if (deviceSelectError.name === "SecurityError") {
                        throw new Error('Bluetooth permission denied. Please allow Bluetooth access for this site in your browser settings.');
                    }
                    throw new Error(`Printer selection failed: ${deviceSelectError.message}. Check Bluetooth settings and printer discoverability.`);
                }
            } else {
                throw new Error('Invalid action selected');
            }

            console.log('Device selected:', this.device.name || 'Unknown device');

            // Connect to GATT server and retrieve services
            let server;
            let services;

            try {
                // Connect to GATT server
                server = await this.device.gatt.connect();
                console.log('Connected to GATT server');

                // Get all available services
                services = await server.getPrimaryServices();
                console.log('Available services:', services.map(s => s.uuid));

                if (services.length === 0) {
                    throw new Error('No services found on the device');
                }
            } catch (connectionError) {
                console.error('Network or connection error:', connectionError);

                // Handle specific error types with more helpful messages
                if (connectionError.name === 'NetworkError' ||
                    connectionError.message.includes('Unsupported device')) {
                    throw new Error('This device is not supported as a printer. Please select a compatible Bluetooth printer.');
                }

                // Re-throw the error if it doesn't match specific cases
                throw connectionError;
            }

            // Try to find a service we can use for printing
            let service = null;
            let characteristic = null;

            // Try each service to find a writable characteristic
            for (const s of services) {
                try {
                    console.log(`Exploring service ${s.uuid}...`);
                    const chars = await s.getCharacteristics();
                    console.log(`Found ${chars.length} characteristics in service ${s.uuid}`);

                    // Find a writable characteristic
                    const writableChar = chars.find(c =>
                        c.properties.write || c.properties.writeWithoutResponse
                    );

                    if (writableChar) {
                        service = s;
                        characteristic = writableChar;
                        break;
                    }
                } catch (e) {
                    console.log(`Error exploring service ${s.uuid}:`, e);
                }
            }

            if (!service || !characteristic) {
                throw new Error('No suitable service or characteristic found for printing. Make sure your printer is turned on and in pairing mode.');
            }

            console.log('Using service:', service.uuid);
            console.log('Using characteristic:', characteristic.uuid);

            this.characteristic = characteristic;
            this.connected = true;

            // Set up disconnection listener to reset state
            this.device.addEventListener('gattserverdisconnected', () => {
                console.log('Bluetooth device disconnected');
                this.connected = false;
                this.characteristic = null;
            });

            // Save successful connection
            this.savePrinter();

            // Show printer size selection modal after successful connection
            try {
                const selectedSize = await this.showPrinterSizeModal();
                this.setPrinterSize(selectedSize);
            } catch (error) {
                console.error('Error setting printer size:', error);
            }

            return true;
        } catch (error) {
            console.error('Error connecting to printer:', error);
            this.connected = false;
            throw error;
        }
    }

    /**
     * Disconnect from the current printer
     */
    async disconnect() {
        if (this.device && this.device.gatt.connected) {
            await this.device.gatt.disconnect();
        }
        this.connected = false;
        this.device = null;
        this.characteristic = null;
    }

    /**
     * Set up visibility change listeners to handle reconnection when tab becomes visible again
     * @private
     */
    _setupVisibilityListeners() {
        // Document visibility change can help restore connection when tab becomes active
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && !this.connected && this.lastConnectedDevice) {
                console.log('Document became visible, attempting to restore printer connection');
                this.reconnectAttempted = false; // Reset the flag to allow reconnection
                this.attemptSilentReconnect();
            }
        });

        // Also try to reconnect on focus
        window.addEventListener('focus', () => {
            if (!this.connected && this.lastConnectedDevice) {
                console.log('Window focused, attempting to restore printer connection');
                this.reconnectAttempted = false; // Reset the flag to allow reconnection
                this.attemptSilentReconnect();
            }
        });
    }

    /**
     * Attempts to connect to a specific printer or default printer
     * @param {Object} printer - Specific printer to use or null for default flow
     * @param {string} receiptName - Name of receipt for user messages
     * @returns {Promise<boolean>} True if successfully connected
     * @private
     */
    async _connectToPrinter(printer, receiptName) {
        // If we have a specific printer for this channel, use it
        if (printer) {
            // Save current connection state
            const previousDevice = this.device;
            const previousConnected = this.connected;
            const previousCharacteristic = this.characteristic;

            try {
                // Temporarily set this device as the last connected device
                this.lastConnectedDevice = {
                    id: printer.deviceId,
                    name: printer.name
                };

                // Only show a connection message if we're not already connected
                if (!this.connected) {
                    this._showToast(`Connecting to ${printer.name || 'printer'}...`, "info");
                }

                // Connect to this specific printer
                await this.ensurePrinterConnection();
                return true;
            } catch (specificPrinterError) {
                console.error(`Error using specific printer:`, specificPrinterError);

                // Restore previous connection state for fallback
                this.device = previousDevice;
                this.connected = previousConnected;
                this.characteristic = previousCharacteristic;

                // Continue to default connection path
            }
        }

        // Default printing path - only show connection messages if we're not connected yet
        if (!this.connected) {
            if (this.lastConnectedDevice) {
                this._showToast("Connecting to printer...", "info");
            } else {
                this._showToast(`Select a printer for ${receiptName}`, "info");
            }
        }

        await this.ensurePrinterConnection();
        return true;
    }

    /**
     * Get saved browser printing preference from localStorage
     * @returns {boolean} Whether browser printing is preferred
     */
    getBrowserPrintingPreference() {
        try {
            const preference = localStorage.getItem('preferBrowserPrinting');
            return preference === 'true';
        } catch (error) {
            console.error('Error retrieving browser printing preference:', error);
            return false;
        }
    }

    /**
     * Save browser printing preference to localStorage
     * @param {boolean} prefer - Whether to prefer browser printing
     */
    saveBrowserPrintingPreference(prefer) {
        try {
            localStorage.setItem('preferBrowserPrinting', prefer ? 'true' : 'false');
            this.preferBrowserPrinting = prefer;
        } catch (error) {
            console.error('Error saving browser printing preference:', error);
        }
    }
}

export const BluetoothPrinting = new BluetoothPrintingClass();