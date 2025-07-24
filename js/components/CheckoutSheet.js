import { useState, useEffect, useMemo, useCallback } from 'react';
import { ChargesCalculator } from '../utils/ChargesCalculator.js';
import { UserSession } from '../utils/UserSession.js';
import { showToast } from '../utils.js';
import { ModalManager } from './ModalManager.js';
import { sdk } from '../sdk.js';
import { Item, MOrder } from '../models/Order.js';
import { UserSession } from '../utils/UserSession.js';
import { BluetoothPrinting } from '../utils/BluetoothPrinting.js';

// CheckoutSheet component for handling order checkout
export function CheckoutSheet({ cart, clearCallback, tableId, checkout, orderId, priceVariant, onClose }) {
    const [discount, setDiscount] = useState(0);
    const [instructions, setInstructions] = useState('');
    const [showDiscountModal, setShowDiscountModal] = useState(false);
    const [percentMode, setPercentMode] = useState(false);
    const [discountInput, setDiscountInput] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);
    const [paymentMode, setPaymentMode] = useState('CASH'); // CASH, DIGITAL, CREDIT
    const [showInstructionsModal, setShowInstructionsModal] = useState(false);
    const [customer, setCustomer] = useState(null);
    const [showCustomerModal, setShowCustomerModal] = useState(false);
    const [customerSearch, setCustomerSearch] = useState('');
    const [customersList, setCustomersList] = useState([]);
    const [isLoadingCustomers, setIsLoadingCustomers] = useState(false);
    const [customersError, setCustomersError] = useState(null);
    // Add state for auto print preference
    const [autoPrint, setAutoPrint] = useState(() => {
        return localStorage.getItem('autoPrintPreference') === 'true';
    });
    // Add state for bill image generation
    const [isGeneratingBill, setIsGeneratingBill] = useState(false);
    const [billImageUrl, setBillImageUrl] = useState(null);

    // Calculate cart totals
    const cartSubTotal = useMemo(() => {
        if (!cart) return 0;
        return Object.values(cart).reduce((total, item) => {
            // Base price from variant or product
            const basePrice = item.variant ? item.variant.price : item.product.price;

            // Add add-ons prices
            const addonsTotal = item.addons ? item.addons.reduce((sum, addon) => sum + addon.price, 0) : 0;

            // Calculate total for this item including quantity
            return total + ((basePrice + addonsTotal) * item.quantity);
        }, 0);
    }, [cart]);

    // Calculate charges (taxes, etc.)
    const chargesCalculation = useMemo(() => {
        if (!cart) return { calculatedCharges: [], totalChargesAmount: 0, finalAmount: 0 };

        // Collect all product charges
        const productCharges = [];
        let commonBulkTaxHashtag = null;
        let allProductsHaveSameHashtag = true;
        let firstProduct = true;

        Object.values(cart).forEach(item => {
            // Check for bulk tax update hashtag
            if (item.product.taxUpdateInfo && item.product.taxUpdateInfo.isFromBulkUpdate) {
                const productHashtag = item.product.taxUpdateInfo.hashtag;

                if (firstProduct) {
                    commonBulkTaxHashtag = productHashtag;
                    firstProduct = false;
                } else if (commonBulkTaxHashtag !== productHashtag) {
                    allProductsHaveSameHashtag = false;
                }
            } else {
                allProductsHaveSameHashtag = false;
            }

            if (item.product.charges && item.product.charges.length > 0) {
                productCharges.push(...item.product.charges);
            }
        });

        // Consolidate charges by name
        const consolidatedCharges = [];
        productCharges.forEach(charge => {
            const existingCharge = consolidatedCharges.find(c => c.name === charge.name && c.type === charge.type);
            if (existingCharge) {
                // For percentage charges, we don't need to sum the percentages
                if (charge.type !== 'percentage') {
                    existingCharge.value = (parseFloat(existingCharge.value) + parseFloat(charge.value)).toString();
                }
            } else {
                consolidatedCharges.push({ ...charge });
            }
        });

        // Add bulk tax update hashtag if all products have the same one
        if (allProductsHaveSameHashtag && commonBulkTaxHashtag) {
            consolidatedCharges.forEach(charge => {
                charge.bulkTaxHashtag = commonBulkTaxHashtag;
            });
        }

        // Use ChargesCalculator to calculate final amounts
        return ChargesCalculator && typeof ChargesCalculator.calculateCharges === 'function'
            ? ChargesCalculator.calculateCharges(cartSubTotal, consolidatedCharges, discount)
            : {
                calculatedCharges: [],
                finalAmount: cartSubTotal - (discount || 0)
            };
    }, [cart, cartSubTotal, discount]);

    // Extract values from calculation
    const { calculatedCharges, finalAmount } = chargesCalculation;
    const cartTotal = finalAmount;

    // Format date properly
    const formatDate = (dateStr) => {
        if (!dateStr) return "Just now";

        try {
            const date = new Date(dateStr);
            // Check if date is valid
            if (isNaN(date.getTime())) return "Just now";

            // Format the date
            return date.toLocaleString('en-IN', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                hour12: true
            });
        } catch (error) {
            console.error("Error formatting date:", error);
            return "Just now";
        }
    };

    // Search and fetch customer data
    const searchCustomers = async (query) => {
        if (!query || query.length < 2) {
            setCustomersList([]);
            return;
        }

        setIsLoadingCustomers(true);
        setCustomersError(null);

        try {
            // Simple query similar to the Flutter implementation
            const customersRef = sdk.db.collection("Customers");

            // Basic query without compound indexing requirements or sellerId filter (handled by SDK)
            let snapshot = await customersRef.get();

            // Filter results client-side (like the Flutter implementation)
            const customers = [];
            const queryLower = query.toLowerCase();

            snapshot.forEach(doc => {
                const data = doc.data();
                const name = (data.name || "").toLowerCase();
                const phone = (data.phone || "").toLowerCase();

                // Simple string contains check like the Flutter code
                if (name.includes(queryLower) || phone.includes(queryLower)) {
                    customers.push({
                        id: doc.id,
                        name: data.name || "",
                        phone: data.phone || "",
                        balance: data.balance || 0,
                        lastPurchase: data.lastPurchase,
                        ...data
                    });
                }
            });

            // Sort by name (client side)
            customers.sort((a, b) => (a.name || "").localeCompare(b.name || ""));

            setCustomersList(customers);
        } catch (error) {
            console.error("Error fetching customers:", error);
            setCustomersError("Failed to load customers");
            setCustomersList([]);
        } finally {
            setIsLoadingCustomers(false);
        }
    };

    // Debounced search for better performance
    const debouncedSearchCustomers = useCallback(
        (() => {
            let timeoutId = null;
            return (query) => {
                if (timeoutId) {
                    clearTimeout(timeoutId);
                }
                timeoutId = setTimeout(() => {
                    searchCustomers(query);
                }, 300); // 300ms delay
            };
        })(),
        []
    );

    // Open customer selection modal
    const openCustomerModal = () => {
        setCustomerSearch('');
        setCustomersList([]);

        if (ModalManager && typeof ModalManager.createCenterModal === 'function') {
            const customerModalContent = `
                <div class="mb-5">
                    <!-- Search input -->
                    <div class="relative">
                        <input
                            type="text"
                            id="customer-search-input"
                            placeholder="Search by name or phone number"
                            class="w-full px-4 py-3 pl-10 pr-8 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-400 bg-white shadow-sm"
                        />
                        <div class="absolute left-3 top-3.5" id="search-icon">
                            <i class="ph ph-magnifying-glass text-gray-400"></i>
                        </div>
                        <div class="absolute left-3 top-3.5 hidden" id="search-loading">
                            <div class="w-4 h-4 border-2 border-red-400 border-t-transparent rounded-full animate-spin"></div>
                        </div>
                        <button
                            id="clear-search-btn"
                            class="absolute right-3 top-3 text-gray-400 hover:text-gray-600 hidden"
                        >
                            <i class="ph ph-x"></i>
                        </button>
                    </div>
                    <div class="mt-2 text-xs text-gray-500 flex justify-between items-center">
                        <span id="search-status">Enter 2+ characters to search</span>
                        <button 
                            id="refresh-customers-btn"
                            class="text-red-500 hover:text-red-600 flex items-center"
                        >
                            <i class="ph ph-arrows-clockwise mr-1 text-xs"></i>
                            Refresh
                        </button>
                    </div>

                    <!-- Create new customer form -->
                    <div class="border-t border-b my-4 py-4">
                        <div class="flex items-center justify-between mb-2">
                            <h4 class="text-sm font-medium text-gray-700">Add New Customer</h4>
                            <span class="text-xs text-gray-500">Required fields *</span>
                        </div>
                        <form id="new-customer-form" class="bg-white rounded-lg">
                            <div class="space-y-3">
                                <div>
                                    <div class="flex items-center mb-1">
                                        <label for="new-customer-name" class="text-sm text-gray-600">Name</label>
                                        <span class="text-red-500 ml-1">*</span>
                                    </div>
                                    <div class="relative">
                                        <i class="ph ph-user absolute left-3 top-2.5 text-gray-400"></i>
                                        <input
                                            id="new-customer-name"
                                            type="text"
                                            placeholder="Customer name"
                                            class="w-full pl-9 px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-red-400"
                                        />
                                    </div>
                                </div>
                                <div>
                                    <label for="new-customer-phone" class="text-sm text-gray-600 block mb-1">Phone Number</label>
                                    <div class="relative">
                                        <i class="ph ph-phone absolute left-3 top-2.5 text-gray-400"></i>
                                        <input
                                            id="new-customer-phone"
                                            type="tel"
                                            placeholder="Phone number"
                                            class="w-full pl-9 px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-red-400"
                                        />
                                    </div>
                                </div>
                                <button
                                    type="submit"
                                    class="w-full py-2.5 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors flex items-center justify-center"
                                >
                                    <i class="ph ph-user-plus mr-2"></i>
                                    Add Customer
                                </button>
                            </div>
                        </form>
                    </div>

                    <!-- Customer list -->
                    <div>
                        <h4 class="text-sm font-medium text-gray-700 mb-3" id="customers-list-title">
                            Recent Customers
                        </h4>
                        
                        <div id="customers-loading" class="flex justify-center items-center py-8">
                            <div class="w-6 h-6 border-2 border-red-500 border-t-transparent rounded-full animate-spin mr-2"></div>
                            <span class="text-gray-500">Loading customers...</span>
                        </div>
                        
                        <div id="customers-error" class="text-center py-8 text-red-500 hidden">
                            <i class="ph ph-warning-circle text-2xl mb-2"></i>
                            <p id="error-message">Error loading customers</p>
                            <button 
                                id="try-again-btn"
                                class="mt-3 text-sm py-1.5 px-3 bg-red-50 text-red-500 rounded-lg hover:bg-red-100 transition-colors"
                            >
                                Try Again
                            </button>
                        </div>
                        
                        <div id="customers-empty" class="text-center py-8 text-gray-500 hidden">
                            <i class="ph ph-users text-3xl mb-2"></i>
                            <p id="empty-message">No customers found</p>
                            <p class="text-sm text-gray-400 mt-2">Try a different search or add a new customer</p>
                        </div>
                        
                        <div id="customers-list" class="space-y-2.5">
                            <!-- Customers will be added here dynamically -->
                        </div>
                    </div>
                </div>
            `;

            const customerModalFooter = `
                <div class="flex gap-3">
                    <button id="cancel-customer-select" class="flex-1 py-2.5 border border-gray-300 text-gray-700 rounded-lg">
                        Cancel
                    </button>
                </div>
            `;
        } else {
            setShowCustomerModal(true);
            // Load customers for the modal view
            loadRecentCustomers();
        }
    };

    // Load recent or top customers
    const loadRecentCustomers = async () => {
        setIsLoadingCustomers(true);
        setCustomersError(null);

        try {
            // Create simple query to get customers, avoiding complex indexing
            // No need for sellerId filter as it's handled by the SDK
            let customersRef = sdk.db.collection("Customers");
            let snapshot = await customersRef.get();

            // Process results
            const customers = [];
            snapshot.forEach(doc => {
                const data = doc.data();
                customers.push({
                    id: doc.id,
                    name: data.name || "",
                    phone: data.phone || "",
                    balance: data.balance || 0,
                    lastPurchase: data.lastPurchase,
                    ...data
                });
            });

            // Sort by lastPurchase date if available (client-side)
            customers.sort((a, b) => {
                // If both have lastPurchase dates
                if (a.lastPurchase && b.lastPurchase) {
                    // Convert to Date objects if needed
                    const dateA = a.lastPurchase instanceof Date ? a.lastPurchase : new Date(a.lastPurchase);
                    const dateB = b.lastPurchase instanceof Date ? b.lastPurchase : new Date(b.lastPurchase);
                    // Reverse sort (newest first)
                    return dateB - dateA;
                }
                // If only one has lastPurchase
                if (a.lastPurchase) return -1;
                if (b.lastPurchase) return 1;
                // If neither has lastPurchase, sort by name
                return (a.name || "").localeCompare(b.name || "");
            });

            // Limit to 15 customers (client-side)
            setCustomersList(customers.slice(0, 15));
        } catch (error) {
            console.error("Error loading recent customers:", error);
            setCustomersError("Failed to load recent customers");
            setCustomersList([]);
        } finally {
            setIsLoadingCustomers(false);
        }
    };

    // Load auto print preference from localStorage during component initialization
    useEffect(() => {
        const savedPreference = localStorage.getItem('autoPrintPreference');
        if (savedPreference !== null) {
            setAutoPrint(savedPreference === 'true');
        }
    }, []);

    // Save auto print preference to localStorage
    const toggleAutoPrint = (value) => {
        const newValue = typeof value === 'boolean' ? value : !autoPrint;
        setAutoPrint(newValue);
        localStorage.setItem('autoPrintPreference', newValue.toString());
        showToast(`Auto print ${newValue ? 'enabled' : 'disabled'}`, "info");
    };

    // Handle checkout
    const handleCheckout = async (mode) => {
        let billPrintedSuccessfully = false;
        let userCancelledBluetooth = false;

        try {
            if (Object.keys(cart).length === 0) {
                showToast("Your cart is empty", "error");
                return;
            }

            // CREDIT mode requires a customer selection
            if (mode === 'CREDIT' && !customer) {
                showToast("Please select a customer for credit purchase", "error");
                openCustomerModal();
                return;
            }

            // Update payment mode if specified
            if (mode) {
                setPaymentMode(mode);
            }

            setIsProcessing(true);

            // Ensure orderId exists or create a new one
            const targetOrderId = orderId || sdk.db.collection("Orders").doc().id;
            const orderRef = sdk.db.collection("Orders").doc(targetOrderId);

            // Convert cart items to Order items format
            const items = Object.values(cart).map(cartItem => {
                let finalItemData;
                try {
                    // Attempt to use the SDK's Item.fromProduct
                    const sdkItem = Item.fromProduct(cartItem.product, cartItem.quantity);
                    finalItemData = sdkItem.data || {}; // Use .data if it exists, otherwise an empty object

                    // Regardless of what Item.fromProduct does, explicitly set/override price and details
                    let effectivePrice = cartItem.variant ? cartItem.variant.price : cartItem.product.price;
                    finalItemData.variantId = cartItem.variant?.id || null;
                    finalItemData.variantName = cartItem.variant?.name || null;

                    let addonsTotal = 0;
                    if (cartItem.addons && cartItem.addons.length > 0) {
                        finalItemData.addons = cartItem.addons.map(addon => ({ id: addon.id, name: addon.name, price: addon.price }));
                        addonsTotal = cartItem.addons.reduce((sum, addon) => sum + addon.price, 0);
                        finalItemData.addonsTotal = addonsTotal;
                    } else {
                        finalItemData.addons = [];
                        finalItemData.addonsTotal = 0;
                    }

                    // Crucial: Set the final price here, AFTER Item.fromProduct and AFTER calculating addons
                    finalItemData.price = effectivePrice + addonsTotal;
                    // Preserve original MRP and other necessary fields that Item.fromProduct might have set
                    finalItemData.pid = finalItemData.pid || cartItem.product.id;
                    finalItemData.title = finalItemData.title || cartItem.product.title;
                    finalItemData.thumb = finalItemData.thumb || cartItem.product.imgs?.[0] || null;
                    finalItemData.cat = finalItemData.cat || cartItem.product.cat || "Other";
                    finalItemData.mrp = finalItemData.mrp || cartItem.product.mrp || cartItem.product.price;
                    finalItemData.veg = finalItemData.veg !== undefined ? finalItemData.veg : cartItem.product.veg || false;
                    finalItemData.served = finalItemData.served !== undefined ? finalItemData.served : false;
                    finalItemData.qnt = finalItemData.qnt || cartItem.quantity;

                    // Return an object that MOrder.fromItems expects (if it expects objects with a .data property)
                    // Or, if MOrder.fromItems expects the data directly, this structure might need adjustment
                    // For now, assuming Item.fromProduct returns an object that can be structured like { data: ... }
                    return { data: finalItemData }; // This structure matches the fallback

                } catch (err) {
                    console.error("Error or issue with Item.fromProduct, using manual fallback (in handleCheckout):", err);
                    // Fallback: Manually construct the item data
                    let basePrice = cartItem.variant ? cartItem.variant.price : cartItem.product.price;
                    const addonsData = (cartItem.addons && cartItem.addons.length > 0)
                        ? cartItem.addons.map(addon => ({ id: addon.id, name: addon.name, price: addon.price }))
                        : [];
                    const addonsTotal = (cartItem.addons && cartItem.addons.length > 0)
                        ? cartItem.addons.reduce((sum, addon) => sum + addon.price, 0)
                        : 0;

                    finalItemData = {
                        pid: cartItem.product.id,
                        title: cartItem.product.title,
                        thumb: cartItem.product.imgs?.[0] || null,
                        cat: cartItem.product.cat || "Other",
                        mrp: cartItem.product.mrp || cartItem.product.price,
                        price: basePrice + addonsTotal, // Final price calculation
                        veg: cartItem.product.veg || false,
                        served: false,
                        qnt: cartItem.quantity,
                        variantId: cartItem.variant?.id || null,
                        variantName: cartItem.variant?.name || null,
                        addons: addonsData,
                        addonsTotal: addonsTotal
                    };

                    // Add tax update info if present
                    if (cartItem.product.taxUpdateInfo) {
                        finalItemData.taxUpdateInfo = cartItem.product.taxUpdateInfo;
                    }

                    return { data: finalItemData }; // Consistent return structure
                }
            });

            // Validate charges format
            const validCharges = calculatedCharges.map(charge => {
                if (typeof charge.toJson === 'function') {
                    return charge;
                } else {
                    // Create a simple charge object if toJson not available
                    return {
                        name: charge.name,
                        value: charge.value,
                        type: charge.type || 'fixed',
                        inclusive: charge.inclusive || false,
                        bulkTaxHashtag: charge.bulkTaxHashtag || null,
                        toJson: function () {
                            return {
                                name: this.name,
                                value: this.value,
                                type: this.type,
                                inclusive: this.inclusive,
                                bulkTaxHashtag: this.bulkTaxHashtag
                            };
                        }
                    };
                }
            });

            // Create or update the order data
            let orderData;

            try {
                // Try using MOrder.fromItems first
                const order = MOrder.fromItems(
                    targetOrderId,
                    items,
                    discount,
                    priceVariant,
                    tableId,
                    instructions.trim(),
                    validCharges
                );
                orderData = order.data;

                // Add payment mode
                orderData.payMode = mode;

                // Add customer details if a customer is selected
                if (customer) {
                    orderData.custId = customer.id;
                    orderData.custName = customer.name;
                    orderData.custPhone = customer.phone;
                }

                // For CREDIT payment mode, mark as unpaid
                if (mode === 'CREDIT') {
                    orderData.paid = false;
                }
                
                // Set isOnline and source properties based on priceVariant or tableId
                if (priceVariant && (priceVariant.toLowerCase() === 'swiggy' || priceVariant.toLowerCase() === 'zomato')) {
                    orderData.isOnline = true;
                    orderData.source = priceVariant.toLowerCase();
                } else if (tableId && tableId.toLowerCase().includes('ac') || 
                           tableId && tableId.toLowerCase().includes('dining')) {
                    orderData.isOnline = false;
                    orderData.orderType = 'dine-in';
                } else if (priceVariant && priceVariant.toLowerCase().includes('online')) {
                    orderData.isOnline = true;
                } else if (tableId) {
                    // Default for tables is offline
                    orderData.isOnline = false;
                }
            } catch (err) {
                console.error("Error creating MOrder:", err);

                // Fallback for direct data creation
                const now = new Date();
                const seller = UserSession?.seller;
                const billNo = seller?.getBillNo ? seller.getBillNo() : Math.floor(Math.random() * 1000000);

                orderData = {
                    id: targetOrderId,
                    billNo: billNo,
                    items: items.map(item => item.data || item),
                    sellerId: seller?.id,
                    priceVariant: priceVariant,
                    tableId: tableId,
                    discount: discount,
                    paid: mode !== 'CREDIT', // Set paid to false for CREDIT mode
                    status: [
                        {
                            label: "PLACED",
                            date: now
                        }
                    ],
                    currentStatus: {
                        label: "PLACED",
                        date: now
                    },
                    charges: validCharges.map(c => typeof c.toJson === 'function' ? c.toJson() : c),
                    payMode: mode,
                    instructions: instructions.trim(),
                    date: now
                };

                // Add customer details if a customer is selected
                if (customer) {
                    orderData.custId = customer.id;
                    orderData.custName = customer.name;
                    orderData.custPhone = customer.phone;
                }
                
                // Set isOnline and source properties based on priceVariant or tableId
                if (priceVariant && (priceVariant.toLowerCase() === 'swiggy' || priceVariant.toLowerCase() === 'zomato')) {
                    orderData.isOnline = true;
                    orderData.source = priceVariant.toLowerCase();
                } else if (tableId && tableId.toLowerCase().includes('ac') || 
                           tableId && tableId.toLowerCase().includes('dining')) {
                    orderData.isOnline = false;
                    orderData.orderType = 'dine-in';
                } else if (priceVariant && priceVariant.toLowerCase().includes('online')) {
                    orderData.isOnline = true;
                } else if (tableId) {
                    // Default for tables is offline
                    orderData.isOnline = false;
                }
            }

            if (!orderId) {
                // Create new order
                // --- Set status to PLACED only ---
                const now = new Date();
                orderData.status = [
                    {
                        label: "PLACED",
                        date: now
                    }
                ];
                orderData.currentStatus = {
                    label: "PLACED",
                    date: now
                };
                await orderRef.set(orderData);
            } else {
                // Update existing order
                const existingDoc = await orderRef.get();
                const existingData = existingDoc.exists ? existingDoc.data() : {};
                let updateData = {};
                if (checkout) {
                    // --- Set status to PLACED only ---
                    const now = new Date();
                    updateData.status = [
                        {
                            label: "PLACED",
                            date: now
                        }
                    ];
                    updateData.currentStatus = {
                        label: "PLACED",
                        date: now
                    };
                    updateData.paid = mode !== 'CREDIT';
                    updateData.payMode = mode;
                    if (customer) {
                        updateData.custId = customer.id;
                        updateData.custName = customer.name;
                        updateData.custPhone = customer.phone;
                    }
                    if (orderData.taxUpdateInfo) {
                        updateData.taxUpdateInfo = orderData.taxUpdateInfo;
                    }
                    if (discount > 0) {
                        updateData.discount = (existingData.discount || 0) + discount;
                    }
                } else {
                    // If not in checkout mode, add items to the existing order
                    updateData = {
                        items: [
                            ...(existingData.items || []),
                            ...items.map(e => e.data || e)
                        ],
                        discount: (existingData.discount || 0) + discount
                    };
                    if (customer) {
                        updateData.custId = customer.id;
                        updateData.custName = customer.name;
                        updateData.custPhone = customer.phone;
                    }
                }
                if (instructions.trim()) {
                    updateData.instructions = instructions.trim();
                }
                await orderRef.update(updateData);
            }

            // Show success message for order placement
            showToast("Order placed successfully!", "success");
            clearCallback && clearCallback();
            onClose && onClose();
        } catch (error) {
            console.error("Checkout error:", error);
            showToast("Failed to process order: " + (error.message || "Unknown error"), "error");
            setIsProcessing(false);
        }
    };

    // Handle discount application
    const applyDiscount = (amount) => {
        // If no amount is provided, use the current discountInput value
        if (amount === undefined) {
            amount = percentMode
                ? ((parseFloat(discountInput) || 0) * cartSubTotal / 100)
                : Math.min(parseFloat(discountInput) || 0, cartSubTotal);
        }

        if (isNaN(amount) || amount < 0) {
            if (ModalManager && typeof ModalManager.showToast === 'function') {
                ModalManager.showToast("Please enter a valid discount amount", { type: "error" });
            } else {
                showToast("Please enter a valid discount amount", "error");
            }
            return;
        }

        if (amount > cartSubTotal) {
            if (ModalManager && typeof ModalManager.showToast === 'function') {
                ModalManager.showToast("Discount cannot be greater than subtotal", { type: "error" });
            } else {
                showToast("Discount cannot be greater than subtotal", "error");
            }
            setDiscount(0);
        } else {
            setDiscount(amount);
            if (ModalManager && typeof ModalManager.showToast === 'function') {
                ModalManager.showToast(`Discount of ${UserSession?.getCurrency()}${amount.toFixed(2)} applied`, { type: "success" });
            } else {
                showToast(`Discount of ${UserSession?.getCurrency()}${amount.toFixed(2)} applied`, "success");
            }
        }
        setShowDiscountModal(false);
    };

    // Open discount modal
    const openDiscountModal = () => {
        if (ModalManager && typeof ModalManager.createCenterModal === 'function') {
            // Reset discount input when opening
            setDiscountInput('');

            const discountModalContent = `
                <div>
                    <!-- Toggle between percentage and fixed amount -->
                    <div class="flex items-center justify-between bg-gray-100 rounded-lg p-1 mb-4">
                        <button id="fixed-amount-btn" class="flex-1 py-2 rounded-md text-center ${!percentMode ? 'bg-white shadow-sm font-medium' : ''}">
                            Fixed Amount
                        </button>
                        <button id="percent-mode-btn" class="flex-1 py-2 rounded-md text-center ${percentMode ? 'bg-white shadow-sm font-medium' : ''}">
                            Percentage (%)
                        </button>
                    </div>

                    <!-- Input field -->
                    <div class="mb-5">
                        <label class="block text-sm text-gray-600 mb-2">
                            ${percentMode ? 'Discount Percentage' : 'Discount Amount'}
                        </label>
                        <div class="flex items-center border rounded-lg overflow-hidden shadow-sm">
                            <span class="px-3 py-2 bg-gray-100 text-gray-500">
                                ${percentMode ? '%' : UserSession?.getCurrency()}
                            </span>
                            <input
                                type="number"
                                id="discount-input"
                                value="${discountInput}"
                                placeholder="0"
                                class="flex-1 px-3 py-2 outline-none"
                            />
                        </div>
                        <p class="text-xs text-gray-500 mt-2">
                            ${percentMode
                    ? 'Enter percentage between 1-100'
                    : `Maximum discount: ${UserSession?.getCurrency()}${cartSubTotal}`}
                        </p>
                    </div>

                    <!-- Summary -->
                    <div class="bg-gray-50 rounded-lg p-4 mb-5">
                        <div className="flex justify-between mb-1">
                            <span className="text-gray-600">Subtotal:</span>
                            <span>${UserSession?.getCurrency()}${cartSubTotal}</span>
                        </div>
                        <div className="flex justify-between mb-1 text-green-600">
                            <span>Discount:</span>
                            <span id="discount-amount">
                                - ${UserSession?.getCurrency()}${percentMode
                    ? ((parseFloat(discountInput) || 0) * cartSubTotal / 100).toFixed(2)
                    : (Math.min(parseFloat(discountInput) || 0, cartSubTotal)).toFixed(2)
                }
                            </span>
                        </div>
                        <div className="flex justify-between font-medium text-lg pt-2 border-t">
                            <span>Final Total:</span>
                            <span id="final-total">
                                {UserSession?.getCurrency()}${percentMode
                    ? (cartSubTotal - ((parseFloat(discountInput) || 0) * cartSubTotal / 100)).toFixed(2)
                    : (cartSubTotal - Math.min(parseFloat(discountInput) || 0, cartSubTotal)).toFixed(2)
                }
                            </span>
                        </div>
                    </div>
                </div>
            `;

            const discountFooter = `
                <div class="flex gap-3">
                    <button id="cancel-discount" class="flex-1 py-2.5 border border-gray-300 text-gray-700 rounded-lg">
                        Cancel
                    </button>
                    <button id="apply-discount" class="flex-1 py-2.5 bg-blue-600 text-white rounded-lg">
                        Apply Discount
                    </button>
                </div>
            `;

            const modal = ModalManager.createCenterModal({
                id: 'discount-modal',
                title: 'Apply Discount',
                content: discountModalContent,
                actions: discountFooter,
                onShown: (modalControl) => {
                    // Add event listeners
                    const fixedAmountBtn = document.getElementById('fixed-amount-btn');
                    const percentModeBtn = document.getElementById('percent-mode-btn');
                    const discountInput = document.getElementById('discount-input');
                    const cancelBtn = document.getElementById('cancel-discount');
                    const applyBtn = document.getElementById('apply-discount');

                    // Set up mode toggle
                    if (fixedAmountBtn) {
                        fixedAmountBtn.addEventListener('click', () => {
                            setPercentMode(false);
                            modalControl.close();
                            setTimeout(openDiscountModal, 50);
                        });
                    }

                    if (percentModeBtn) {
                        percentModeBtn.addEventListener('click', () => {
                            setPercentMode(true);
                            modalControl.close();
                            setTimeout(openDiscountModal, 50);
                        });
                    }

                    // Set up input changes
                    if (discountInput) {
                        discountInput.addEventListener('input', (e) => {
                            const newValue = e.target.value;
                            setDiscountInput(newValue);

                            // Update summary
                            const discountAmount = document.getElementById('discount-amount');
                            const finalTotal = document.getElementById('final-total');

                            if (discountAmount && finalTotal) {
                                const calculatedDiscount = percentMode
                                    ? ((parseFloat(newValue) || 0) * cartSubTotal / 100)
                                    : Math.min(parseFloat(newValue) || 0, cartSubTotal);

                                discountAmount.textContent = `- ${UserSession?.getCurrency()}${calculatedDiscount.toFixed(2)}`;
                                finalTotal.textContent = `${UserSession?.getCurrency()}${(cartSubTotal - calculatedDiscount).toFixed(2)}`;
                            }
                        });
                    }

                    // Set up buttons
                    if (cancelBtn) {
                        cancelBtn.addEventListener('click', () => modalControl.close());
                    }

                    if (applyBtn) {
                        applyBtn.addEventListener('click', () => {
                            applyDiscount();
                            modalControl.close();
                        });
                    }
                }
            });
        } else {
            setShowDiscountModal(true);
        }
    };

    // Open instructions modal
    const openInstructionsModal = () => {
        if (ModalManager && typeof ModalManager.createCenterModal === 'function') {
            const instructionsContent = `
                <div class="mb-5">
                    <textarea
                        id="instructions-textarea"
                        placeholder="Add any special instructions for this order..."
                        class="w-full p-3 border rounded-lg h-32 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >${instructions}</textarea>
                </div>
            `;

            const instructionsFooter = `
                <div class="flex gap-3">
                    <button id="cancel-instructions" class="flex-1 py-2.5 border border-gray-300 text-gray-700 rounded-lg">
                        Cancel
                    </button>
                    <button id="save-instructions" class="flex-1 py-2.5 bg-blue-600 text-white rounded-lg">
                        Save Instructions
                    </button>
                </div>
            `;

            const modal = ModalManager.createCenterModal({
                id: 'instructions-modal',
                title: 'Order Instructions',
                content: instructionsContent,
                actions: instructionsFooter,
                onShown: (modalControl) => {
                    // Add event listeners
                    const instructionsTextarea = document.getElementById('instructions-textarea');
                    const cancelBtn = document.getElementById('cancel-instructions');
                    const saveBtn = document.getElementById('save-instructions');

                    if (cancelBtn) {
                        cancelBtn.addEventListener('click', () => modalControl.close());
                    }

                    if (saveBtn) {
                        saveBtn.addEventListener('click', () => {
                            if (instructionsTextarea) {
                                setInstructions(instructionsTextarea.value);
                                if (ModalManager.showToast) {
                                    ModalManager.showToast("Instructions saved");
                                }
                            }
                            modalControl.close();
                        });
                    }
                }
            });
        } else {
            setShowInstructionsModal(true);
        }
    };

    // Generate shareable bill image
    const generateBillImage = async () => {
        if (!orderId) {
            showToast("No order available to share", "error");
            return null;
        }

        setIsGeneratingBill(true);

        try {
            // Get order data
            const orderData = await BluetoothPrinting?.getOrderData(orderId);
            if (!orderData) {
                showToast("Order not found", "error");
                setIsGeneratingBill(false);
                return null;
            }

            // Get seller information
            const seller = UserSession?.seller || {};

            // Check if we have a custom template
            const hasCustomTemplate = seller.printTemplate &&
                seller.printTemplate.bill &&
                seller.printTemplate.bill.sections &&
                seller.printTemplate.bill.sections.length > 0;

            // Get template data if available
            const templateData = hasCustomTemplate ? seller.printTemplate.bill : null;

            // Generate HTML using PrintTemplate
            const template = new BluetoothPrinting.PrintTemplate({
                type: 'bill',
                orderData: orderData,
                seller: seller,
                templateData: templateData
            });
            const receiptHtml = template.toHTML();

            // Create an iframe to render the HTML
            const iframe = document.createElement('iframe');
            iframe.style.visibility = 'hidden';
            iframe.style.position = 'absolute';
            iframe.style.width = '400px'; // Set fixed width for consistent rendering
            iframe.style.height = '800px'; // Set initial height
            document.body.appendChild(iframe);

            // Write HTML content to iframe
            iframe.contentDocument.open();
            iframe.contentDocument.write(receiptHtml);
            iframe.contentDocument.close();

            // Wait for iframe content to load
            await new Promise(resolve => {
                if (iframe.contentDocument.readyState === 'complete') {
                    resolve();
                } else {
                    iframe.onload = resolve;
                    // Fallback timeout
                    setTimeout(resolve, 1500);
                }
            });

            // Get the receipt container element
            const receiptContent = iframe.contentDocument.querySelector('.printer-container');

            if (!receiptContent) {
                throw new Error("Receipt content container not found");
            }

            // Force a layout calculation
            receiptContent.style.margin = '0';
            receiptContent.style.padding = '0';
            receiptContent.style.backgroundColor = '#FFFFFF';

            // Wait for layout to stabilize
            await new Promise(resolve => setTimeout(resolve, 200));

            // Check if html2canvas is available
            if (typeof html2canvas !== 'function') {
                throw new Error("html2canvas library not available. Please refresh the page and try again.");
            }

            // Capture the receipt content as PNG with error handling
            let pngDataUrl;
            try {
                // Use html2canvas to capture the receipt
                const canvas = await html2canvas(receiptContent, {
                    backgroundColor: '#FFFFFF',
                    scale: 2, // Higher resolution for better quality
                    useCORS: true,
                    allowTaint: true,
                    logging: false
                });
                
                // Convert canvas to data URL
                pngDataUrl = canvas.toDataURL('image/png');
            } catch (screenshotError) {
                console.error("Error capturing screenshot:", screenshotError);
                throw new Error("Failed to generate bill image: " + (screenshotError.message || "Screenshot error"));
            }

            // Clean up
            document.body.removeChild(iframe);

            // Set the bill image URL
            setBillImageUrl(pngDataUrl);
            showToast("Bill image generated successfully", "success");
            return pngDataUrl;
        } catch (error) {
            console.error("Error generating bill image:", error);
            showToast("Failed to generate bill image: " + (error.message || "Unknown error"), "error");
            return null;
        } finally {
            setIsGeneratingBill(false);
        }
    };

    // Helper function to convert data URL to Blob
    const dataURLtoBlob = (dataURL) => {
        if (!dataURL || typeof dataURL !== 'string' || !dataURL.startsWith('data:')) {
            console.error("Invalid dataURL provided to dataURLtoBlob:", dataURL);
            throw new Error("Invalid data URL format");
        }

        try {
            const arr = dataURL.split(',');
            if (arr.length < 2) {
                throw new Error("Invalid data URL format: missing comma separator");
            }

            const mimeMatch = arr[0].match(/:(.*?);/);
            if (!mimeMatch || !mimeMatch[1]) {
                throw new Error("Invalid data URL format: cannot extract MIME type");
            }

            const mime = mimeMatch[1];
            const bstr = atob(arr[1]);
            let n = bstr.length;
            const u8arr = new Uint8Array(n);

            while (n--) {
                u8arr[n] = bstr.charCodeAt(n);
            }

            return new Blob([u8arr], { type: mime });
        } catch (error) {
            console.error("Error in dataURLtoBlob:", error);
            throw new Error("Failed to convert data URL to Blob: " + error.message);
        }
    };

    // Share bill via WhatsApp
    const shareBillViaWhatsApp = async () => {
        try {
            // Variable to hold the image data - either from state or newly generated
            let imageData = billImageUrl;

            if (!imageData) {
                console.log("Bill image not available, generating now...");
                // Generate the image and store the returned data directly
                imageData = await generateBillImage();
                if (!imageData) {
                    showToast("Could not generate bill image. Please try again.", "error");
                    return; // Exit if image generation failed
                }
                console.log("Bill image generated successfully");

                // No need to wait for state update since we're using the direct return value
            }

            console.log("Bill image available, proceeding with WhatsApp sharing");

            // Get order details for a more descriptive message
            const orderData = await BluetoothPrinting?.getOrderData(orderId);
            const billNo = orderData?.billNo || orderId || '';
            const total = orderData?.total || cartTotal || 0;

            // Create a more descriptive message
            const text = `Here is your bill #${billNo} from ${UserSession?.seller?.name || 'us'}.\nTotal: ${UserSession?.getCurrency()}${total.toFixed(2)}\nThank you for your business!`;

            // Validate imageData before proceeding
            if (!imageData || typeof imageData !== 'string' || !imageData.startsWith('data:')) {
                console.error("Invalid image data:", imageData);
                showToast("Invalid bill image format. Please try again.", "error");
                return;
            }

            // Create a blob from the data URL for sharing
            let blob;
            try {
                blob = dataURLtoBlob(imageData);
                if (!blob) {
                    throw new Error("Failed to create blob from image data");
                }
            } catch (blobError) {
                console.error("Error creating blob:", blobError);
                showToast("Failed to process bill image. Please try again.", "error");
                return;
            }

            const file = new File([blob], `bill-${billNo}.png`, { type: "image/png" });

            // First try Web Share API if available - this can share both text and image on supported platforms
            if (navigator.canShare && navigator.canShare({ files: [file] })) {
                try {
                    await navigator.share({
                        files: [file],
                        title: 'Your Bill',
                        text: text
                    });
                    showToast("Bill shared successfully", "success");
                    return; // Exit if successful
                } catch (shareError) {
                    console.log("Web Share API failed, falling back to WhatsApp link", shareError);
                    // Continue to fallback methods
                }
            }

            // More reliable desktop detection - check for touch support and screen size
            const isDesktop = (window.innerWidth > 1024 && !('ontouchstart' in window)) ||
                !/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

            // If Web Share API is not available or failed, show a modal with options
            if (ModalManager && typeof ModalManager.createCenterModal === 'function') {
                // Save the bill image first for easy access
                const downloadLink = document.createElement('a');
                downloadLink.href = imageData; // Use our local imageData variable instead of billImageUrl
                downloadLink.download = `bill-${billNo}.png`;

                // Create modal content with specific WhatsApp Web instructions for desktop
                const modalContent = `
                    <div class="text-center">
                        <div class="mb-4">
                            <img src="${imageData}" alt="Bill" class="max-w-full h-auto mx-auto border rounded-lg shadow-sm" style="max-height: 300px;" />
                        </div>
                        ${isDesktop ? `
                        <div class="mb-4 bg-green-50 p-3 rounded-lg text-left">
                            <h4 class="font-medium text-green-800 mb-2">WhatsApp Web Sharing Guide:</h4>
                            <div class="flex items-center justify-center mb-3">
                                <div class="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center mr-2">
                                    <span class="text-green-800 font-bold">1</span>
                                </div>
                                <div class="flex-1">
                                    <p class="font-medium">Download the bill image first</p>
                                </div>
                            </div>
                            <div class="flex items-center justify-center mb-3">
                                <div class="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center mr-2">
                                    <span class="text-green-800 font-bold">2</span>
                                </div>
                                <div class="flex-1">
                                    <p class="font-medium">Copy the message text below</p>
                                </div>
                            </div>
                            <div class="flex items-center justify-center">
                                <div class="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center mr-2">
                                    <span class="text-green-800 font-bold">3</span>
                                </div>
                                <div class="flex-1">
                                    <p class="font-medium">Open WhatsApp Web and send both</p>
                                </div>
                            </div>
                        </div>
                        <div class="mb-4 bg-gray-50 p-3 rounded-lg">
                            <p class="text-sm text-gray-600 mb-2">Message text (click to copy):</p>
                            <div id="copy-text-area" class="text-sm bg-white p-3 rounded border cursor-pointer text-left flex items-center justify-between">
                                <span>${text.replace(/\n/g, '<br>')}</span>
                                <span class="text-blue-500 ml-2"><i class="ph ph-copy"></i></span>
                            </div>
                            <div id="copy-success" class="text-xs text-green-600 mt-1 hidden">
                                <i class="ph ph-check"></i> Copied to clipboard!
                            </div>
                        </div>
                        ` : `
                        <p class="mb-4 text-gray-700">WhatsApp can't directly attach images from web apps. Please choose one of these options:</p>
                        `}
                        <div class="space-y-3">
                            <button id="download-then-share" class="w-full py-2.5 bg-green-500 text-white rounded-lg flex items-center justify-center hover:bg-green-600 transition-colors">
                                <i class="ph ph-download mr-2"></i>
                                ${isDesktop ? 'Step 1: Download Bill Image' : 'Download bill image first'}
                            </button>
                            ${isDesktop ? `
                            <button id="copy-message" class="w-full py-2.5 bg-blue-500 text-white rounded-lg flex items-center justify-center hover:bg-blue-600 transition-colors">
                                <i class="ph ph-clipboard-text mr-2"></i>
                                Step 2: Copy Message Text
                            </button>
                            <button id="open-whatsapp-web" class="w-full py-2.5 bg-green-600 text-white rounded-lg flex items-center justify-center hover:bg-green-700 transition-colors">
                                <i class="ph ph-whatsapp-logo mr-2"></i>
                                Step 3: Open WhatsApp Web
                            </button>
                            ` : `
                            <button id="share-whatsapp-text" class="w-full py-2.5 bg-green-600 text-white rounded-lg flex items-center justify-center hover:bg-green-700 transition-colors">
                                <i class="ph ph-whatsapp-logo mr-2"></i>
                                Share text only via WhatsApp
                            </button>
                            `}
                        </div>
                        ${isDesktop ? `
                        <div class="mt-4 pt-3 border-t border-gray-200">
                            <div class="bg-blue-50 p-3 rounded-lg text-left">
                                <h5 class="font-medium text-blue-800 mb-2">How to attach the image in WhatsApp Web:</h5>
                                <ol class="text-sm text-blue-700 space-y-1 list-decimal pl-4">
                                    <li>In WhatsApp Web, click the <i class="ph ph-paperclip"></i> attachment icon</li>
                                    <li>Select "Photos & Videos"</li>
                                    <li>Navigate to your Downloads folder</li>
                                    <li>Select the bill image you just downloaded</li>
                                    <li>Paste the copied message text</li>
                                    <li>Click send</li>
                                </ol>
                            </div>
                        </div>
                        ` : ''}
                    </div>
                `;

                ModalManager.createCenterModal({
                    title: 'Share Bill via WhatsApp',
                    content: modalContent,
                    onShown: (modalControl) => {
                        // Set up download button
                        const downloadBtn = document.getElementById('download-then-share');
                        if (downloadBtn) {
                            downloadBtn.addEventListener('click', () => {
                                try {
                                    // Download the image
                                    document.body.appendChild(downloadLink);
                                    downloadLink.click();
                                    document.body.removeChild(downloadLink);

                                    // Show toast
                                    showToast("Bill image downloaded successfully", "success");

                                    // Highlight the next step for desktop users
                                    if (isDesktop) {
                                        const copyBtn = document.getElementById('copy-message');
                                        if (copyBtn) {
                                            copyBtn.classList.add('animate-pulse');
                                            setTimeout(() => {
                                                copyBtn.classList.remove('animate-pulse');
                                            }, 2000);
                                        }

                                        // Mark this step as completed
                                        downloadBtn.classList.remove('bg-green-500', 'hover:bg-green-600');
                                        downloadBtn.classList.add('bg-gray-400');
                                        downloadBtn.innerHTML = '<i class="ph ph-check mr-2"></i> Image Downloaded';
                                    } else {
                                        // For mobile, continue with opening WhatsApp
                                        const customerPhone = customer?.phone || '';
                                        let whatsappUrl;

                                        if (customerPhone && customerPhone.trim()) {
                                            // Format phone number - remove non-digits
                                            const phoneNumber = customerPhone.replace(/\D/g, '');
                                            whatsappUrl = `https://wa.me/${phoneNumber}?text=${encodeURIComponent(text)}`;
                                        } else {
                                            // No phone number, use general link
                                            whatsappUrl = `https://wa.me/?text=${encodeURIComponent(text)}`;
                                        }

                                        // Open WhatsApp after a short delay
                                        setTimeout(() => {
                                            window.open(whatsappUrl, '_blank');
                                            modalControl.close();
                                        }, 1000);
                                    }
                                } catch (err) {
                                    console.error("Error downloading image:", err);
                                    showToast("Failed to download image. Please try again.", "error");
                                }
                            });
                        }

                        // Set up copy message button for desktop
                        if (isDesktop) {
                            const copyMessageBtn = document.getElementById('copy-message');
                            if (copyMessageBtn) {
                                copyMessageBtn.addEventListener('click', () => {
                                    try {
                                        navigator.clipboard.writeText(text)
                                            .then(() => {
                                                showToast("Message copied to clipboard", "success");

                                                // Show visual feedback
                                                const copySuccess = document.getElementById('copy-success');
                                                if (copySuccess) {
                                                    copySuccess.classList.remove('hidden');
                                                    setTimeout(() => {
                                                        copySuccess.classList.add('hidden');
                                                    }, 2000);
                                                }

                                                // Mark this step as completed
                                                copyMessageBtn.classList.remove('bg-blue-500', 'hover:bg-blue-600');
                                                copyMessageBtn.classList.add('bg-gray-400');
                                                copyMessageBtn.innerHTML = '<i class="ph ph-check mr-2"></i> Message Copied';

                                                // Highlight the next step
                                                const whatsappBtn = document.getElementById('open-whatsapp-web');
                                                if (whatsappBtn) {
                                                    whatsappBtn.classList.add('animate-pulse');
                                                    setTimeout(() => {
                                                        whatsappBtn.classList.remove('animate-pulse');
                                                    }, 2000);
                                                }
                                            })
                                            .catch(err => {
                                                console.error('Failed to copy text: ', err);
                                                showToast("Failed to copy text. Please try selecting and copying manually.", "error");
                                            });
                                    } catch (err) {
                                        console.error("Error copying message:", err);
                                        showToast("Failed to copy message. Please try manually.", "error");
                                    }
                                });
                            }

                            // Set up copy text area functionality
                            const copyTextArea = document.getElementById('copy-text-area');
                            const copySuccess = document.getElementById('copy-success');
                            if (copyTextArea && copySuccess) {
                                copyTextArea.addEventListener('click', () => {
                                    navigator.clipboard.writeText(text)
                                        .then(() => {
                                            copySuccess.classList.remove('hidden');
                                            copyTextArea.classList.add('bg-green-50', 'border-green-200');

                                            // Mark the copy button as completed
                                            const copyMessageBtn = document.getElementById('copy-message');
                                            if (copyMessageBtn) {
                                                copyMessageBtn.classList.remove('bg-blue-500', 'hover:bg-blue-600');
                                                copyMessageBtn.classList.add('bg-gray-400');
                                                copyMessageBtn.innerHTML = '<i class="ph ph-check mr-2"></i> Message Copied';
                                            }

                                            setTimeout(() => {
                                                copySuccess.classList.add('hidden');
                                                copyTextArea.classList.remove('bg-green-50', 'border-green-200');
                                            }, 2000);
                                        })
                                        .catch(err => {
                                            console.error('Failed to copy text: ', err);
                                            showToast("Failed to copy text. Please try selecting and copying manually.", "error");
                                        });
                                });
                            }
                        }

                        // Set up WhatsApp Web button for desktop
                        if (isDesktop) {
                            const openWhatsAppBtn = document.getElementById('open-whatsapp-web');
                            if (openWhatsAppBtn) {
                                openWhatsAppBtn.addEventListener('click', () => {
                                    try {
                                        // Check if customer phone is available
                                        const customerPhone = customer?.phone || '';
                                        let whatsappUrl;

                                        if (customerPhone && customerPhone.trim()) {
                                            // Format phone number - remove non-digits
                                            const phoneNumber = customerPhone.replace(/\D/g, '');
                                            whatsappUrl = `https://web.whatsapp.com/send?phone=${phoneNumber}`;
                                        } else {
                                            // No phone number, just open WhatsApp Web
                                            whatsappUrl = 'https://web.whatsapp.com/';
                                        }

                                        window.open(whatsappUrl, '_blank');

                                        // Mark this step as completed
                                        openWhatsAppBtn.classList.remove('bg-green-600', 'hover:bg-green-700');
                                        openWhatsAppBtn.classList.add('bg-gray-400');
                                        openWhatsAppBtn.innerHTML = '<i class="ph ph-check mr-2"></i> WhatsApp Web Opened';

                                        showToast("WhatsApp Web opened. Please attach the downloaded bill image.", "info");
                                    } catch (err) {
                                        console.error("Error opening WhatsApp Web:", err);
                                        showToast("Failed to open WhatsApp Web. Please try manually.", "error");
                                    }
                                });
                            }
                        } else {
                            // Set up text-only share button for mobile
                            const shareTextBtn = document.getElementById('share-whatsapp-text');
                            if (shareTextBtn) {
                                shareTextBtn.addEventListener('click', () => {
                                    try {
                                        // Check if customer phone is available
                                        const customerPhone = customer?.phone || '';
                                        let whatsappUrl;

                                        if (customerPhone && customerPhone.trim()) {
                                            // Format phone number - remove non-digits
                                            const phoneNumber = customerPhone.replace(/\D/g, '');
                                            whatsappUrl = `https://wa.me/${phoneNumber}?text=${encodeURIComponent(text)}`;
                                        } else {
                                            // No phone number, use general link
                                            whatsappUrl = `https://wa.me/?text=${encodeURIComponent(text)}`;
                                        }

                                        window.open(whatsappUrl, '_blank');
                                        modalControl.close();
                                    } catch (err) {
                                        console.error("Error opening WhatsApp:", err);
                                        showToast("Failed to open WhatsApp. Please try manually.", "error");
                                    }
                                });
                            }
                        }
                    }
                });
            } else {
                // If modal manager is not available, fall back to basic approach
                // Download the image first
                try {
                    const downloadLink = document.createElement('a');
                    downloadLink.href = imageData; // Use our local imageData variable instead of billImageUrl
                    downloadLink.download = `bill-${billNo}.png`;
                    document.body.appendChild(downloadLink);
                    downloadLink.click();
                    document.body.removeChild(downloadLink);

                    // Check if customer phone is available
                    const customerPhone = customer?.phone || '';
                    let whatsappUrl;

                    if (customerPhone && customerPhone.trim()) {
                        // Format phone number - remove non-digits
                        const phoneNumber = customerPhone.replace(/\D/g, '');

                        // Use different URLs for desktop and mobile
                        if (isDesktop) {
                            whatsappUrl = `https://web.whatsapp.com/send?phone=${phoneNumber}`;
                            showToast("Bill image downloaded. Please attach it manually in WhatsApp Web", "info");
                        } else {
                            whatsappUrl = `https://wa.me/${phoneNumber}?text=${encodeURIComponent(text)}`;
                            showToast("Bill image downloaded. Now you can attach it in WhatsApp", "success");
                        }
                    } else {
                        // No phone number, use general link
                        if (isDesktop) {
                            whatsappUrl = 'https://web.whatsapp.com/';
                            showToast("Bill image downloaded. Please attach it manually in WhatsApp Web", "info");
                        } else {
                            whatsappUrl = `https://wa.me/?text=${encodeURIComponent(text)}`;
                            showToast("Bill image downloaded. Now you can attach it in WhatsApp", "success");
                        }
                    }

                    // Open WhatsApp after a short delay
                    setTimeout(() => {
                        window.open(whatsappUrl, '_blank');
                    }, 1000);
                } catch (err) {
                    console.error("Error in basic sharing approach:", err);
                    showToast("Failed to share bill. Please try again.", "error");
                }
            }
        } catch (error) {
            console.error("Error sharing via WhatsApp:", error);
            showToast("Failed to share bill: " + (error.message || "Unknown error"), "error");
        }
    };

    // Share bill via SMS
    const shareBillViaSMS = async () => {
        if (!billImageUrl) {
            const generatedImage = await generateBillImage();
            if (!generatedImage) {
                return; // Exit if image generation failed
            }
            // Small delay to ensure state is updated
            await new Promise(resolve => setTimeout(resolve, 300));
        }

        try {
            const customerPhone = customer?.phone || '';
            const text = `Here is your bill from ${UserSession?.seller?.name || 'us'}`;

            // Use native SMS app through URL scheme
            const smsUrl = `sms:${customerPhone}?body=${encodeURIComponent(text)}`;
            window.open(smsUrl, '_blank');

            // If SMS URL fails, try Web Share API as fallback
            setTimeout(() => {
                // Create a blob from the data URL
                const blob = dataURLtoBlob(billImageUrl);

                // Create a File object from the Blob
                const file = new File([blob], "bill.png", { type: "image/png" });

                // Check if Web Share API with files is supported
                if (navigator.canShare && navigator.canShare({ files: [file] })) {
                    navigator.share({
                        files: [file],
                        title: 'Your Bill',
                        text: text
                    }).catch(err => {
                        console.log("Web Share API fallback also failed:", err);
                    });
                }
            }, 1000); // Give some time for the SMS app to open
        } catch (error) {
            console.error("Error sharing via SMS:", error);
            showToast("Failed to share bill: " + (error.message || "Unknown error"), "error");
        }
    };

    // Share bill via Email
    const shareBillViaEmail = async () => {
        if (!billImageUrl) {
            const generatedImage = await generateBillImage();
            if (!generatedImage) {
                return; // Exit if image generation failed
            }
            // Small delay to ensure state is updated
            await new Promise(resolve => setTimeout(resolve, 300));
        }

        try {
            const customerEmail = customer?.email || '';
            const subject = `Your Bill from ${UserSession?.seller?.name || 'Restaurant'}`;
            const body = `Here is your bill from ${UserSession?.seller?.name || 'us'}. Thank you for your business!`;

            // Primary approach: Use mailto link for web email
            const mailtoUrl = `mailto:${customerEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

            // Try to open email client
            const newWindow = window.open(mailtoUrl, '_blank');

            // If window.open was blocked or failed, try Web Share API as fallback
            if (!newWindow || newWindow.closed || typeof newWindow.closed === 'undefined') {
                console.log("Email client link failed, trying Web Share API fallback");

                // Create a blob from the data URL
                const blob = dataURLtoBlob(billImageUrl);

                // Create a File object from the Blob
                const file = new File([blob], "bill.png", { type: "image/png" });

                // Check if Web Share API with files is supported
                if (navigator.canShare && navigator.canShare({ files: [file] })) {
                    await navigator.share({
                        files: [file],
                        title: subject,
                        text: body
                    });
                }
            }
        } catch (error) {
            console.error("Error sharing via Email:", error);
            showToast("Failed to share bill: " + (error.message || "Unknown error"), "error");
        }
    };

    // Add a download function for direct download of bill image
    const downloadBill = async () => {
        // Variable to hold the image data - either from state or newly generated
        let imageData = billImageUrl;

        if (!imageData) {
            console.log("Bill image not available for download, generating now...");
            // Generate the image and store the returned data directly
            imageData = await generateBillImage();
            if (!imageData) {
                showToast("Could not generate bill image. Please try again.", "error");
                return; // Exit if image generation failed
            }
            console.log("Bill image generated successfully for download");
            // No need to wait for state update since we're using the direct return value
        }

        try {
            // Create an anchor element for download
            const downloadLink = document.createElement('a');
            downloadLink.href = imageData; // Use our local imageData variable
            downloadLink.download = `bill-${orderId || 'receipt'}.png`;

            // Append to body, click and remove
            document.body.appendChild(downloadLink);
            downloadLink.click();
            document.body.removeChild(downloadLink);

            showToast("Bill downloaded successfully", "success");
        } catch (error) {
            console.error("Error downloading bill:", error);
            showToast("Failed to download bill: " + (error.message || "Unknown error"), "error");
        }
    };

    // Handle printing bill
    const handlePrintBill = async () => {
        if (!orderId) {
            showToast("Complete payment first to print bill", "error");
            return;
        }

        try {
            setIsGeneratingBill(true);
            
            // First update the order with customer information if available
            if (customer) {
                try {
                    console.log("Updating order with customer information:", {
                        customerId: customer.id,
                        customerName: customer.name,
                        customerPhone: customer.phone
                    });
                    
                    const orderRef = sdk.db.collection("Orders").doc(orderId);
                    await orderRef.update({
                        custId: customer.id,
                        custName: customer.name,
                        custPhone: customer.phone,
                        customer: {
                            id: customer.id,
                            name: customer.name,
                            phone: customer.phone
                        }
                    });
                    console.log("Updated order with customer information before printing");
                } catch (updateError) {
                    console.error("Error updating order with customer info:", updateError);
                }
            } else {
                console.log("No customer selected, will use Guest in the bill");
            }
            
            // Try Bluetooth printing if available
            if (BluetoothPrinting && BluetoothPrinting.isSupported()) {
                const printerAlreadyConnected = BluetoothPrinting.connected && BluetoothPrinting.characteristic;
                
                if (printerAlreadyConnected) {
                    showToast("Printing bill using connected printer...", "info");
                } else if (BluetoothPrinting.lastConnectedDevice) {
                    showToast(`Connecting to printer ${BluetoothPrinting.lastConnectedDevice.name}...`, "info");
                } else {
                    showToast("Select a printer to print bill", "info");
                }

                // Get order channel and payment mode for proper template variables
                const channel = priceVariant || 'Default';
                
                await BluetoothPrinting.printBill(orderId, paymentMode, false, channel);
                showToast("Bill printed successfully", "success");
            } else {
                // Fallback to browser printing or image generation
                const billImage = await generateBillImage();
                if (billImage) {
                    showToast("Bill generated successfully", "success");
                } else {
                    showToast("Failed to generate bill", "error");
                }
            }
        } catch (error) {
            console.error('Error printing bill:', error);
            showToast(`Failed to print bill: ${error.message}`, "error");
        } finally {
            setIsGeneratingBill(false);
        }
    };

    if (Object.keys(cart).length === 0) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-end z-50" onClick={() => onClose?.()}>
            <div
                className="bg-white h-full w-full sm:max-w-md md:max-w-lg flex flex-col overflow-hidden shadow-lg"
                onClick={(e) => e.stopPropagation()}
                style={{ backgroundColor: "#fffcfc" }}
            >
                {/* Header */}
                <div className="sticky top-0 z-10 bg-white" style={{ backgroundColor: "#fff8f8" }}>
                    <div className="flex items-center justify-between p-4 border-b relative">
                        <div className="flex items-center">
                            <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center mr-3">
                                <i className="ph ph-shopping-cart text-red-600 text-xl"></i>
                            </div>
                            <h2 className="text-xl font-semibold text-gray-800">Checkout</h2>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={openDiscountModal}
                                className="p-2 hover:bg-red-50 rounded-full transition-colors"
                                title="Apply Discount"
                            >
                                <i className="ph ph-tag text-red-600"></i>
                            </button>
                            <button
                                onClick={openInstructionsModal}
                                className="p-2 hover:bg-red-50 rounded-full transition-colors"
                                title="Add Instructions"
                            >
                                <i className="ph ph-note-pencil text-gray-600"></i>
                            </button>
                            <button
                                onClick={toggleAutoPrint}
                                className={`p-2 ${autoPrint ? 'bg-red-50' : 'hover:bg-red-50'} rounded-full transition-colors`}
                                title={autoPrint ? "Disable Auto Print" : "Enable Auto Print"}
                            >
                                <i className={`ph ph-printer ${autoPrint ? 'text-red-600' : 'text-gray-600'}`}></i>
                            </button>
                            <button
                                onClick={() => onClose?.()}
                                className="p-2 hover:bg-red-50 rounded-full transition-colors"
                                aria-label="Close"
                            >
                                <i className="ph ph-x text-red-600"></i>
                            </button>
                        </div>
                    </div>

                    {/* Order Info */}
                    <div className="bg-pink-50 px-4 py-2 border-b flex justify-between items-center">
                        <div className="text-sm text-gray-600 flex items-center">
                            <i className="ph ph-shopping-bag text-red-500 mr-1"></i>
                            {Object.values(cart).reduce((total, item) => total + item.quantity, 0)} items
                        </div>
                        <div className="text-sm text-gray-600 flex items-center">
                            <i className="ph ph-calendar text-red-500 mr-1"></i>
                            {formatDate(new Date())}
                        </div>
                    </div>
                </div>

                {/* Main content - Scrollable area */}
                <div className="overflow-y-auto flex-1" style={{ scrollbarWidth: 'thin', backgroundColor: "#fffcfc" }}>
                    {/* Items list */}
                    <div className="p-4">
                        <h3 className="font-medium text-gray-700 mb-3">Order Items</h3>
                        <div className="space-y-3">
                            {Object.values(cart).map((item, index) => (
                                <div key={index} className="flex items-start p-3 bg-white rounded-xl shadow-sm hover:shadow transition-shadow duration-200">
                                    <div className="w-16 h-16 bg-gray-100 rounded-lg overflow-hidden mr-3 flex-shrink-0">
                                        {item.product.imgs && item.product.imgs.length > 0 ? (
                                            <img
                                                src={item.product.imgs[0]}
                                                alt={item.product.title}
                                                className="w-full h-full object-cover"
                                                onError={(e) => {
                                                    e.target.onerror = null;
                                                    e.target.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 24 24" fill="none" stroke="%23ccc" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>';
                                                }}
                                            />
                                        ) : (
                                            <div className="w-full h-full flex items-center justify-center">
                                                <i className="ph ph-image text-gray-400 text-xl" />
                                            </div>
                                        )}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="font-medium text-gray-900 text-lg">{item.product.title}</div>

                                        {/* Show selected variation if any */}
                                        {item.variant && (
                                            <div className="text-sm text-gray-600 mt-0.5">
                                                Variation: {item.variant.name}
                                            </div>
                                        )}

                                        {/* Show selected add-ons if any */}
                                        {item.addons && item.addons.length > 0 && (
                                            <div className="text-sm text-gray-600 mt-0.5">
                                                Add-ons: {item.addons.map(addon => addon.name).join(', ')}
                                            </div>
                                        )}

                                        <div className="text-sm text-gray-600 mt-0.5">
                                            {item.quantity} × ${UserSession?.getCurrency()}{item.variant ? item.variant.price : item.product.price}
                                            {item.addons && item.addons.length > 0 && (
                                                <span className="text-gray-500">
                                                    {' '}(+${UserSession?.getCurrency()}{item.addons.reduce((sum, addon) => sum + addon.price, 0)} add-ons)
                                                </span>
                                            )}
                                        </div>

                                        {item.product.veg !== undefined && (
                                            <div className="mt-1">
                                                <span className={`inline-block w-4 h-4 border ${item.product.veg ? 'border-green-500' : 'border-red-500'} p-0.5 rounded-sm`}>
                                                    <span className={`block w-full h-full rounded-sm ${item.product.veg ? 'bg-green-500' : 'bg-red-500'}`}></span>
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                    <div className="font-medium text-right whitespace-nowrap text-red-600">
                                        {UserSession?.getCurrency()}{((item.variant ? item.variant.price : item.product.price) * item.quantity +
                                            (item.addons ? item.addons.reduce((sum, addon) => sum + addon.price, 0) * item.quantity : 0)).toFixed(2)}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Instructions */}
                    <div className="px-4 pb-4">
                        <h3 className="font-medium text-gray-700 mb-2">Special Instructions</h3>
                        <textarea
                            value={instructions}
                            onChange={(e) => setInstructions(e.target.value)}
                            placeholder="Add any special instructions here"
                            className="w-full p-3 border border-gray-200 rounded-lg resize-none text-gray-700 focus:outline-none focus:ring-2 focus:ring-red-400 bg-white"
                            rows="2"
                            maxLength={300}
                        />
                    </div>
                </div>

                {/* Order summary - Fixed at bottom */}
                <div className="bg-white border-t shadow-md" style={{ backgroundColor: "#fff8f8" }}>
                    <div className="p-4">
                        <div className="space-y-2">
                            <div className="flex justify-between">
                                <span className="text-gray-600">Sub Total</span>
                                <span>{UserSession?.getCurrency()}{cartSubTotal.toFixed(2)}</span>
                            </div>

                            {/* Charges */}
                            {calculatedCharges && calculatedCharges.length > 0 && (
                                <div className="flex justify-between text-gray-600">
                                    <span>Tax & Charges</span>
                                    <div className="text-right">
                                        {/* Display inclusive taxes first with a note */}
                                        {calculatedCharges.filter(charge => charge.isInclusive).length > 0 && (
                                            <div className="mb-1">
                                                <div className="text-xs text-green-600 font-medium">Inclusive Taxes (included in price):</div>
                                                {calculatedCharges
                                                    .filter(charge => charge.isInclusive && charge.calculatedAmount > 0)
                                                    .map((charge, index) => (
                                                        <div key={`inc-${index}`} className="text-green-600">
                                                            {charge.displayName}: {UserSession?.getCurrency()}{charge.calculatedAmount.toFixed(2)}
                                                        </div>
                                                    ))}
                                            </div>
                                        )}
                                        
                                        {/* Display exclusive taxes that add to the total */}
                                        {calculatedCharges.filter(charge => !charge.isInclusive).length > 0 && (
                                            <div>
                                                {calculatedCharges.filter(charge => !charge.isInclusive).length > 0 && 
                                                    calculatedCharges.filter(charge => charge.isInclusive).length > 0 && (
                                                    <div className="text-xs text-gray-600 font-medium mt-1">Exclusive Taxes (added to price):</div>
                                                )}
                                                {calculatedCharges
                                                    .filter(charge => !charge.isInclusive)
                                                    .map((charge, index) => (
                                                        <div key={`exc-${index}`}>
                                                            {charge.displayName}: {UserSession?.getCurrency()}{charge.calculatedAmount.toFixed(2)}
                                                        </div>
                                                    ))}
                                            </div>
                                        )}
                                        
                                        {calculatedCharges.some(charge => charge.bulkTaxHashtag) && (
                                            <div className="text-xs text-blue-500 mt-1">
                                                Bulk Tax Update Applied
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            {discount > 0 && (
                                <div className="flex justify-between text-green-600">
                                    <span>Discount</span>
                                    <span>- {UserSession?.getCurrency()}{discount.toFixed(2)}</span>
                                </div>
                            )}

                            <div className="border-t border-gray-200 pt-2 flex justify-between mt-2">
                                <span className="font-medium">Grand Total</span>
                                <span className="font-semibold text-red-600">{UserSession?.getCurrency()}{cartTotal.toFixed(2)}</span>
                            </div>
                        </div>

                        {/* Print Status Indicator */}
                        <div className="mt-2 flex items-center justify-center text-xs text-gray-500">
                            <i className={`ph ${autoPrint ? 'ph-printer' : 'ph-printer-off'} mr-1`}></i>
                            <span>{autoPrint ? "Auto-print enabled" : "Printing is optional"}</span>
                        </div>

                        {/* Customer Section */}
                        <div className="mt-4">
                            {customer ? (
                                <div className="bg-red-50 rounded-lg mb-3 overflow-hidden">
                                    <div className="flex items-start p-3">
                                        <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center mr-3 flex-shrink-0">
                                            <i className="ph ph-user text-red-600"></i>
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="font-medium text-gray-900">{customer.name}</div>
                                            {customer.phone && (
                                                <div className="text-sm text-gray-600 flex items-center mt-0.5">
                                                    <i className="ph ph-phone text-xs mr-1.5"></i>
                                                    {customer.phone}
                                                </div>
                                            )}
                                            {typeof customer.balance === 'number' && customer.balance < 0 && (
                                                <div className="text-sm text-red-600 font-medium mt-1 flex items-center">
                                                    <i className="ph ph-currency-circle-dollar text-xs mr-1.5"></i>
                                                    Previous Due: {UserSession?.getCurrency()}{Math.abs(customer.balance).toFixed(2)}
                                                </div>
                                            )}
                                        </div>
                                        <button
                                            onClick={() => setCustomer(null)}
                                            className="p-1.5 rounded-full hover:bg-red-100 text-red-600 transition-colors"
                                            title="Remove customer"
                                        >
                                            <i className="ph ph-x"></i>
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <div className="mb-3">
                                    {/* Search Input */}
                                    <div className="relative mb-2">
                                        <input
                                            type="text"
                                            placeholder="Search customers by name or phone"
                                            value={customerSearch}
                                            onChange={(e) => {
                                                setCustomerSearch(e.target.value);
                                                debouncedSearchCustomers(e.target.value);
                                            }}
                                            onFocus={() => {
                                                // Load recent customers when focused
                                                if (customersList.length === 0) {
                                                    loadRecentCustomers();
                                                }
                                            }}
                                            className="w-full pl-10 pr-10 py-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-400 bg-white"
                                        />
                                        <div className="absolute left-3 top-3.5">
                                            {isLoadingCustomers ? (
                                                <div className="w-4 h-4 border-2 border-red-400 border-t-transparent rounded-full animate-spin"></div>
                                            ) : (
                                                <i className="ph ph-magnifying-glass text-gray-400"></i>
                                            )}
                                        </div>
                                        <div className="absolute right-3 top-3.5 flex">
                                            {customerSearch && (
                                                <button
                                                    onClick={() => {
                                                        setCustomerSearch('');
                                                        setCustomersList([]);
                                                    }}
                                                    className="p-0.5 text-gray-400 hover:text-gray-600"
                                                >
                                                    <i className="ph ph-x"></i>
                                                </button>
                                            )}
                                        </div>
                                    </div>

                                    {/* Quick Add New Customer Form - Displayed when no search results */}
                                    {customerSearch && customerSearch.length >= 2 && customersList.length === 0 && !isLoadingCustomers && (
                                        <div className="mt-2 p-3 bg-white border border-gray-200 rounded-lg">
                                            <div className="flex items-center justify-between mb-2">
                                                <h4 className="text-sm font-medium text-gray-700">Add "{customerSearch}" as new customer</h4>
                                                <span className="text-xs text-red-500">* Required</span>
                                            </div>

                                            <div className="space-y-3">
                                                <div>
                                                    <label className="text-xs text-gray-600 block mb-1">
                                                        Name <span className="text-red-500">*</span>
                                                    </label>
                                                    <div className="relative">
                                                        <i className="ph ph-user absolute left-3 top-2.5 text-gray-400"></i>
                                                        <input
                                                            id="quick-customer-name"
                                                            type="text"
                                                            defaultValue={customerSearch}
                                                            placeholder="Customer name"
                                                            className="w-full pl-9 px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-red-400"
                                                        />
                                                    </div>
                                                </div>

                                                <div>
                                                    <label className="text-xs text-gray-600 block mb-1">Phone Number</label>
                                                    <div className="relative">
                                                        <i className="ph ph-phone absolute left-3 top-2.5 text-gray-400"></i>
                                                        <input
                                                            id="quick-customer-phone"
                                                            type="tel"
                                                            placeholder="Phone number"
                                                            className="w-full pl-9 px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-red-400"
                                                        />
                                                    </div>
                                                </div>

                                                <button
                                                    onClick={(e) => {
                                                        e.preventDefault();
                                                        const nameInput = document.getElementById('quick-customer-name');
                                                        const phoneInput = document.getElementById('quick-customer-phone');

                                                        if (!nameInput.value.trim()) {
                                                            if (ModalManager && ModalManager.showToast) {
                                                                ModalManager.showToast("Customer name is required", { type: "error" });
                                                            } else {
                                                                showToast("Customer name is required", "error");
                                                            }
                                                            nameInput.focus();
                                                            return;
                                                        }

                                                        // Create new customer
                                                        const newCustomer = {
                                                            name: nameInput.value.trim(),
                                                            phone: phoneInput.value.trim(),
                                                            balance: 0,
                                                            createdAt: new Date(),
                                                            lastPurchase: new Date(),
                                                            sellerId: UserSession?.seller?.id
                                                        };

                                                        // Add to Firestore
                                                        sdk.db.collection("Customers").add(newCustomer)
                                                            .then(docRef => {
                                                                // Set as selected customer
                                                                setCustomer({
                                                                    ...newCustomer,
                                                                    id: docRef.id
                                                                });

                                                                if (ModalManager && ModalManager.showToast) {
                                                                    ModalManager.showToast("New customer added", { type: "success" });
                                                                } else {
                                                                    showToast("New customer added", "success");
                                                                }

                                                                setCustomerSearch('');
                                                                setCustomersList([]);
                                                            })
                                                            .catch(error => {
                                                                console.error("Error adding customer:", error);
                                                                if (ModalManager && ModalManager.showToast) {
                                                                    ModalManager.showToast("Failed to add customer", { type: "error" });
                                                                } else {
                                                                    showToast("Failed to add customer", "error");
                                                                }
                                                            });
                                                    }}
                                                    className="w-full py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors flex items-center justify-center"
                                                >
                                                    <i className="ph ph-user-plus mr-2"></i>
                                                    Add Customer
                                                </button>
                                            </div>
                                        </div>
                                    )}

                                    {/* Autocomplete Results */}
                                    {(customersList.length > 0 || (customerSearch === '' && isLoadingCustomers)) && (
                                        <div className="absolute z-20 mt-1 w-full bg-white rounded-lg border border-gray-200 shadow-lg max-h-60 overflow-y-auto">
                                            {isLoadingCustomers ? (
                                                <div className="p-4 text-center text-gray-500">
                                                    <div className="w-5 h-5 border-2 border-red-400 border-t-transparent rounded-full animate-spin mx-auto mb-1"></div>
                                                    <div className="text-sm">Loading customers...</div>
                                                </div>
                                            ) : (
                                                <>
                                                    {customersList.map(cust => (
                                                        <div
                                                            key={cust.id}
                                                            className="p-2 hover:bg-red-50 cursor-pointer border-b border-gray-100 flex items-center"
                                                            onClick={() => {
                                                                setCustomer(cust);
                                                                setCustomerSearch('');
                                                                setCustomersList([]);
                                                            }}
                                                        >
                                                            <div className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center mr-2">
                                                                <i className="ph ph-user text-gray-500"></i>
                                                            </div>
                                                            <div className="flex-1 min-w-0">
                                                                <div className="font-medium text-gray-800">{cust.name}</div>
                                                                <div className="flex items-center justify-between">
                                                                    <div className="text-sm text-gray-500 flex items-center">
                                                                        {cust.phone && (
                                                                            <span className="flex items-center mr-2">
                                                                                <i className="ph ph-phone text-xs mr-1"></i>
                                                                                {cust.phone}
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                    {cust.balance < 0 && (
                                                                        <div className="text-xs text-red-500">{UserSession?.getCurrency()}{Math.abs(cust.balance).toFixed(2)} due</div>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    ))}
                                                    {customersList.length === 0 && (
                                                        <div className="p-3 text-center text-gray-500">
                                                            <i className="ph ph-users text-xl mb-1"></i>
                                                            <div>No customers found</div>
                                                        </div>
                                                    )}
                                                </>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Action buttons */}
                        {!checkout ? (
                            <div className="mt-4">
                                <button
                                    onClick={() => handleCheckout()}
                                    disabled={isProcessing}
                                    className={`w-full bg-red-500 text-white py-3 rounded-lg font-medium flex items-center justify-center hover:bg-red-600 transition-colors ${isProcessing ? 'opacity-75 cursor-not-allowed' : ''}`}
                                >
                                    {isProcessing ? (
                                        <>
                                            <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin mr-2"></div>
                                            Processing...
                                        </>
                                    ) : (
                                        <>
                                            <span>Place Order</span>
                                            <i className="ph ph-arrow-right ml-2" />
                                        </>
                                    )}
                                </button>
                            </div>
                        ) : (
                            <div className="mt-4 space-y-3">
                                {/* Payment options - Now these directly complete the order */}
                                <h3 className="font-medium text-center text-gray-700 mb-2">Select Payment Method</h3>
                                <div className="grid grid-cols-3 gap-2">
                                    <button
                                        onClick={() => handleCheckout('CASH')}
                                        disabled={isProcessing}
                                        className={`bg-red-500 text-white py-3 px-2 rounded-lg font-medium flex flex-col items-center justify-center hover:bg-red-600 transition-colors ${isProcessing ? 'opacity-75 cursor-not-allowed' : ''} ${paymentMode === 'CASH' ? 'ring-2 ring-red-300' : ''}`}
                                    >
                                        <i className="ph ph-money text-xl mb-1" />
                                        <span className="text-sm">Cash</span>
                                    </button>
                                    <button
                                        onClick={() => handleCheckout('DIGITAL')}
                                        disabled={isProcessing}
                                        className={`bg-red-500 text-white py-3 px-2 rounded-lg font-medium flex flex-col items-center justify-center hover:bg-red-600 transition-colors ${isProcessing ? 'opacity-75 cursor-not-allowed' : ''} ${paymentMode === 'DIGITAL' ? 'ring-2 ring-red-300' : ''}`}
                                    >
                                        <i className="ph ph-credit-card text-xl mb-1" />
                                        <span className="text-sm">UPI/Card</span>
                                    </button>
                                    <button
                                        onClick={() => handleCheckout('CREDIT')}
                                        disabled={isProcessing || !customer}
                                        className={`bg-red-500 text-white py-3 px-2 rounded-lg font-medium flex flex-col items-center justify-center hover:bg-red-600 transition-colors ${isProcessing || !customer ? 'opacity-75 cursor-not-allowed' : ''} ${paymentMode === 'CREDIT' ? 'ring-2 ring-red-300' : ''}`}
                                        title={!customer ? "Select a customer first" : ""}
                                    >
                                        <i className="ph ph-notebook text-xl mb-1" />
                                        <span className="text-sm">Credit</span>
                                    </button>
                                </div>
                                
                                {/* Print Bill Button - Added below payment options */}
                                <div className="mt-3">
                                    <button
                                        onClick={handlePrintBill}
                                        disabled={isProcessing || !orderId}
                                        className={`w-full bg-red-500 text-white py-3 px-2 rounded-lg font-medium flex items-center justify-center hover:bg-red-600 transition-colors ${(isProcessing || !orderId) ? 'opacity-75 cursor-not-allowed' : ''}`}
                                    >
                                        <i className="ph ph-printer text-xl mr-2" />
                                        <span>{isProcessing ? 'Printing...' : 'Print Bill'}</span>
                                    </button>
                                    {!orderId && <p className="text-xs text-center mt-1 text-gray-500">Complete payment to enable printing</p>}
                                    {customer && <p className="text-xs text-center mt-1 text-green-500">Will print with customer: {customer.name}</p>}
                                </div>

                                {/* Credit info if customer selected */}
                                {customer && typeof customer.balance === 'number' && (
                                    <div className="text-sm text-center text-gray-600 mt-2">
                                        {customer.balance < 0 ? (
                                            <>
                                                <span className="text-gray-700 font-medium">Current Due: </span>
                                                <span className="text-red-600 font-medium">{UserSession?.getCurrency()}{Math.abs(customer.balance).toFixed(2)}</span>
                                                <span className="mx-1">+</span>
                                                <span className="text-red-600 font-medium">{UserSession?.getCurrency()}{cartTotal.toFixed(2)}</span>
                                                <span className="mx-1">=</span>
                                                <span className="text-red-600 font-medium">{UserSession?.getCurrency()}{(Math.abs(customer.balance) + cartTotal).toFixed(2)}</span>
                                            </>
                                        ) : (
                                            <>
                                                <span className="text-gray-700 font-medium">New Due: </span>
                                                <span className="text-red-600 font-medium">{UserSession?.getCurrency()}{cartTotal.toFixed(2)}</span>
                                            </>
                                        )}
                                    </div>
                                )}

                                {/* Share bill options - Add this section */}
                                {orderId && (
                                    <div className="mt-4">
                                        <h3 className="font-medium text-center text-gray-700 mb-2">Share Bill with Customer</h3>
                                        <div className="grid grid-cols-4 gap-2">
                                            <button
                                                onClick={shareBillViaWhatsApp}
                                                disabled={isGeneratingBill}
                                                className="bg-green-500 text-white py-2.5 px-1 rounded-lg font-medium flex flex-col items-center justify-center hover:bg-green-600 transition-colors"
                                            >
                                                <i className="ph ph-whatsapp-logo text-lg mb-0.5" />
                                                <span className="text-xs">WhatsApp</span>
                                            </button>
                                            <button
                                                onClick={shareBillViaSMS}
                                                disabled={isGeneratingBill}
                                                className="bg-blue-500 text-white py-2.5 px-1 rounded-lg font-medium flex flex-col items-center justify-center hover:bg-blue-600 transition-colors"
                                            >
                                                <i className="ph ph-chat-text text-lg mb-0.5" />
                                                <span className="text-xs">Text</span>
                                            </button>
                                            <button
                                                onClick={shareBillViaEmail}
                                                disabled={isGeneratingBill}
                                                className="bg-purple-500 text-white py-2.5 px-1 rounded-lg font-medium flex flex-col items-center justify-center hover:bg-purple-600 transition-colors"
                                            >
                                                <i className="ph ph-envelope text-lg mb-0.5" />
                                                <span className="text-xs">Email</span>
                                            </button>
                                            <button
                                                onClick={downloadBill}
                                                disabled={isGeneratingBill}
                                                className="bg-gray-600 text-white py-2.5 px-1 rounded-lg font-medium flex flex-col items-center justify-center hover:bg-gray-700 transition-colors"
                                            >
                                                <i className="ph ph-download text-lg mb-0.5" />
                                                <span className="text-xs">Save</span>
                                            </button>
                                        </div>
                                        {isGeneratingBill && (
                                            <div className="mt-2 text-center text-sm text-gray-600 flex items-center justify-center">
                                                <div className="w-4 h-4 border-2 border-gray-600 border-t-transparent rounded-full animate-spin mr-2"></div>
                                                Generating bill image...
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Add a prominent print bill button */}
                                {orderId && (
                                    <div className="mt-4">
                                        <button
                                            onClick={handlePrintBill}
                                            disabled={isProcessing || isGeneratingBill}
                                            className={`w-full py-3.5 bg-red-500 text-white rounded-lg font-medium hover:bg-red-600 transition-colors flex items-center justify-center gap-2 shadow-md ${(isProcessing || isGeneratingBill) ? 'opacity-75 cursor-not-allowed' : ''}`}
                                        >
                                            <i className="ph ph-printer text-xl"></i>
                                            <span className="text-base">{isProcessing || isGeneratingBill ? 'Printing...' : 'Print Bill'}</span>
                                        </button>
                                        {customer && (
                                            <div className="mt-1 text-center text-sm text-green-600 flex items-center justify-center">
                                                <i className="ph ph-user text-sm mr-1"></i>
                                                <span>Will print with customer: {customer.name}</span>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Processing state indicator */}
                                {isProcessing && (
                                    <div className="mt-3 py-3 bg-gray-100 rounded-lg text-center text-gray-700">
                                        <div className="w-5 h-5 border-2 border-red-500 border-t-transparent rounded-full animate-spin mx-auto mb-2"></div>
                                        Processing payment...
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

// Add a method to create the checkout sheet with ModalManager
CheckoutSheet.createWithModalManager = function (options) {
    const { cart, clearCallback, tableId, checkout, orderId, priceVariant, onClose } = options;

    // If ModalManager doesn't exist or createSideDrawerModal isn't available, fallback to React rendering
    if (!ModalManager || typeof ModalManager.createSideDrawerModal !== 'function') {
        console.warn("ModalManager not available, using fallback rendering");
        return null; // Let the caller handle the fallback
    }

    // Create a container for ReactDOM to render into
    const container = document.createElement('div');
    document.body.appendChild(container);

    // Render the component into the container
    ReactDOM.render(
        <CheckoutSheet
            cart={cart}
            clearCallback={clearCallback}
            tableId={tableId}
            checkout={checkout}
            orderId={orderId}
            priceVariant={priceVariant}
            onClose={() => {
                if (onClose) onClose();
                // Clean up React component when modal is closed
                setTimeout(() => {
                    ReactDOM.unmountComponentAtNode(container);
                    container.remove();
                }, 0);
            }}
        />,
        container
    );

    // Return a control object that can be used to close the modal
    return {
        close: () => {
            if (onClose) onClose();
            // Clean up React component
            ReactDOM.unmountComponentAtNode(container);
            container.remove();
        }
    };
};
