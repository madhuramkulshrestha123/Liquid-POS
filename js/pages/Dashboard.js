import { useState, useRef, useMemo, useEffect } from 'react';
import DashboardCard from '../components/DashboardCard.js';
import { TableCard } from '../components/TableCard.js';
import { AddTableModal, RenameRoomModal } from '../components/Modals.js';
import { CurrencyData } from '../utils/CurrencyData.js';
import { useProfile } from '../contexts/ProfileContext.js';
import { useOrders } from '../contexts/OrderContext.js';
import { ModalManager } from '../components/ModalManager.js';
import { parseDate, getTimeDuration } from '../utils.js';
import { showToast } from '../utils/toast.js';
import { UserSession } from '../utils/UserSession.js';
import { OrderRoom } from '../components/Modals.js';
import { sdk } from '../sdk.js';
import { NoOrdersFound, OrderGroupTile } from '../components/TableCard.js';

// Safe logging utility to avoid console.error issues
const safeLog = {
    info: (message, ...args) => {
        try {
            setTimeout(() => console.log(message, ...args), 0);
        } catch (e) {}
    },
    error: (message, ...args) => {
        try {
            setTimeout(() => console.log('[ERROR] ' + message, ...args), 0);
        } catch (e) {}
    },
    warn: (message, ...args) => {
        try {
            setTimeout(() => console.log('[WARNING] ' + message, ...args), 0);
        } catch (e) {}
    }
};

// Dashboard Component
export default function Dashboard() {
    const { profile: seller, tables: profileTables } = useProfile ? useProfile() : { profile: null, tables: [] };
    const {
        activeOrders,
        completedOrders,
        isLoading,
        error: orderError,
        getOrdersByTableAndChannel,
        loadCompletedOrders,
        getOrdersForSource
    } = useOrders ? useOrders() : {
        activeOrders: [],
        completedOrders: [],
        isLoading: true,
        error: null,
        getOrdersByTableAndChannel: () => ({ tableOrders: {}, channelOrders: {} }),
        loadCompletedOrders: () => { },
        getOrdersForSource: () => []
    };

    const [error, setError] = useState(null);
    const [isProfileOpen, setIsProfileOpen] = useState(false);
    const [showCompletedOrders, setShowCompletedOrders] = useState(false);
    const [qrOrders, setQrOrders] = useState([]);
    const [loadingQrOrders, setLoadingQrOrders] = useState(true);
    const [errorQrOrders, setErrorQrOrders] = useState(null);
    const [loadedItemCount, setLoadedItemCount] = useState(50); // Initially load 50 items
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const qrOrdersScrollRef = useRef(null);
    const [isAddTableModalOpen, setIsAddTableModalOpen] = useState(false);
    const [isRenameRoomModalOpen, setIsRenameRoomModalOpen] = useState(false);
    const [selectedTableId, setSelectedTableId] = useState(null);
    const [selectedVariant, setSelectedVariant] = useState(null);
    const [orders, setOrders] = useState([]);
    const [kitchenOrders, setKitchenOrders] = useState([]); // New state for KITCHEN orders only
    const [loadingCompletedOrders, setLoadingCompletedOrders] = useState(true);
    const [errorCompletedOrders, setErrorCompletedOrders] = useState(null);
    const [isOrderRoomOpen, setIsOrderRoomOpen] = useState(false);
    const [selectedRoomTableId, setSelectedRoomTableId] = useState(null);
    const [selectedRoomVariant, setSelectedRoomVariant] = useState(null);
    const [activeView, setActiveView] = useState('dashboard'); // 'dashboard' or 'settings'
    const [dashboardMetrics, setDashboardMetrics] = useState({
        todayOrders: 0,
        todayRevenue: 0,
        newCustomers: 0,
        avgOrderValue: 0,
        avgServiceTime: 0,
        todayOrdersTrend: 0,
        todayRevenueTrend: 0,
        newCustomersTrend: 0,
        avgOrderValueTrend: 0,
        avgServiceTimeTrend: 0
    });

    // Computed state for tables and channels
    const [tables, setTables] = useState([]);
    const [channels, setChannels] = useState([]);

    // State for date filtering in completed orders
    const [dateFilter, setDateFilter] = useState('7days'); // Options: today, yesterday, 7days, custom
    const [customDateRange, setCustomDateRange] = useState({
        startDate: null,
        endDate: null
    });

    // Add a state to store unsubscribe functions
    const [kitchenOrdersUnsubscribe, setKitchenOrdersUnsubscribe] = useState(null);
    const [completedOrdersUnsubscribe, setCompletedOrdersUnsubscribe] = useState(null);

    // Add state for the unsubscribe function
    const [placedOrdersUnsubscribe, setPlacedOrdersUnsubscribe] = useState(null);

    // Add refreshTables function to window object
    useEffect(() => {
        // Function to refresh tables UI
        window.refreshTables = () => {
            // Force re-render of tables from profile
            if (profileTables && profileTables.length > 0) {
                setTables((prevTables) => {
                    // Merge profile tables with any dynamic tables that might exist
                    const dynamicTables = prevTables.filter(t =>
                        t.section === 'dynamic' && !profileTables.some(pt => pt.title === t.id)
                    );
                    return [...profileTables, ...dynamicTables];
                });
            }
        };

        // Expose setupKitchenOrdersListener to window object
        window.setupKitchenOrdersListener = setupKitchenOrdersListener;

        // Clean up
        return () => {
            window.refreshTables = null;
            window.setupKitchenOrdersListener = null;
        };
    }, [profileTables]);

    // Get the OrderContext data to update tables and channels
    useEffect(() => {
        // Depend on locally fetched 'kitchenOrders' state instead of 'orders'
        if (!seller || !kitchenOrders) return;

        console.log(`[Kitchen useEffect] Processing ${kitchenOrders.length} KITCHEN orders...`);
        console.log(`[Kitchen useEffect] Kitchen orders:`, kitchenOrders);

        try {
            // No need to filter - kitchenOrders already contains only KITCHEN status orders
            const relevantOrders = kitchenOrders;

            // --- Manual Grouping Logic ---
            const tableOrdersMap = {};
            const channelOrdersMap = {};

            relevantOrders.forEach(order => {
                // Filter out orders without items
                if (!order.items || order.items.length === 0) return;

                // Extract values and check if they are valid (not null, undefined, or empty string)
                const tableId = order.tableId || null;
                const priceVariant = order.priceVariant || null;

                const hasValidTableId = tableId !== null && tableId !== undefined && tableId !== '';
                // Consider "Default" as a valid priceVariant that should go to Default channel
                const isDefaultVariant = priceVariant === 'Default' || priceVariant === '⚡Default';
                const hasValidPriceVariant = priceVariant !== null && priceVariant !== undefined && priceVariant !== '' && !isDefaultVariant;

                // Log every order processing for debugging
                console.log(`[Dashboard Grouping] Order ID: ${order.id}, HasTableID: ${hasValidTableId}, HasPriceVariant: ${hasValidPriceVariant}, IsDefaultVariant: ${isDefaultVariant}`);
                console.log(`  TableID: '${tableId || ''}' (${typeof tableId}), PriceVariant: '${priceVariant || ''}' (${typeof priceVariant})`);

                // 1. Handle table assignments first - if there's a valid tableId
                if (hasValidTableId) {
                    if (!tableOrdersMap[tableId]) {
                        tableOrdersMap[tableId] = [];
                    }
                    tableOrdersMap[tableId].push(order);
                    console.log(`[Dashboard Grouping]   Assigned to Table: ${tableId}`);
                }
                // 2. Handle specific non-Default price variant channels (if no tableId and variant is meaningful)
                else if (hasValidPriceVariant) {
                    if (!channelOrdersMap[priceVariant]) {
                        channelOrdersMap[priceVariant] = [];
                    }
                    channelOrdersMap[priceVariant].push(order);
                    console.log(`[Dashboard Grouping]   Assigned to Channel: ${priceVariant}`);
                }
                // 3. Handle Default channel for both cases:
                //    - orders explicitly marked with Default variant
                //    - orders without any tableId or meaningful priceVariant
                else {
                    if (!channelOrdersMap['Default']) {
                        channelOrdersMap['Default'] = [];
                    }
                    channelOrdersMap['Default'].push(order);

                    if (isDefaultVariant) {
                        console.log(`[Dashboard Grouping]   Assigned to Channel: Default (Explicitly marked as Default)`);
                    } else {
                        console.log(`[Dashboard Grouping]   Assigned to Channel: Default (No tableId or priceVariant)`);
                    }
                }
            });
            // --- End Manual Grouping Logic --- 

            // Summarize the final assignment counts
            console.log(`[Dashboard Grouping Summary] Final assignments:`);
            console.log(`  - Total orders processed: ${relevantOrders.length}`);
            console.log(`  - Tables: ${Object.keys(tableOrdersMap).length} tables with orders`);
            console.log(`  - Channels: ${Object.keys(channelOrdersMap).length} channels with orders`);
            if (channelOrdersMap['Default']) {
                console.log(`  - Default channel: ${channelOrdersMap['Default'].length} orders`);
            } else {
                console.log(`  - Default channel: Not created (no orders)`);
            }

            // Get price variants from seller profile
            const priceVariants = (seller?.priceVariants || [])
                .map(v => v.title)
                .filter(Boolean);

            // Also collect unique price variants from orders
            const orderPriceVariants = new Set();
            relevantOrders.forEach(order => {
                if (order.priceVariant && order.priceVariant !== '') {
                    orderPriceVariants.add(order.priceVariant);
                }
            });

            // Combine both sources
            const allPriceVariants = [...new Set([...priceVariants, ...orderPriceVariants])];

            // Always ensure we have a Default variant for channel creation
            if (!allPriceVariants.includes('Default')) {
                allPriceVariants.unshift('Default');
            }

            // Log all variants
            console.log(`[Dashboard] Price variants from profile: ${priceVariants.join(', ')}`);
            console.log(`[Dashboard] Price variants from orders: ${[...orderPriceVariants].join(', ')}`);
            console.log(`[Dashboard] Combined price variants: ${allPriceVariants.join(', ')}`);

            // Create channel definitions based on all defined price variants
            const normalizedNames = new Set();
            const orderChannels = [];

            allPriceVariants.forEach(variant => {
                const normalizedName = variant.toLowerCase();
                if (!normalizedNames.has(normalizedName)) {
                    normalizedNames.add(normalizedName);
                    orderChannels.push({
                        id: variant, // Use the variant title as ID
                        title: variant,
                        type: 'price_variant',
                        isChannel: true
                    });
                }
            });

            // Convert seller tables to the format we need
            const formattedTables = (seller?.tables || []).map(table => ({
                id: table.id || table.title, // Use title as fallback id
                title: table.title,
                desc: table.desc,
                type: table.type || 'dine_in',
                section: table.section || 'main', // Provide a default section
                isTable: true
            }));

            // Also collect unique tableIds from orders that are not in the seller profile
            const profileTableIds = new Set(formattedTables.map(table => table.id));
            const orderTableIds = new Set();

            relevantOrders.forEach(order => {
                if (order.tableId && !profileTableIds.has(order.tableId)) {
                    orderTableIds.add(order.tableId);
                }
            });

            // Add dynamic tables from orders
            const dynamicTables = [...orderTableIds].map(tableId => ({
                id: tableId,
                title: tableId,
                type: 'dine_in',
                section: 'dynamic', // Mark these as dynamic
                isTable: true
            }));

            // Combine profile tables with dynamic tables from orders
            const allTables = [...formattedTables, ...dynamicTables];

            console.log(`[Dashboard] Tables from profile: ${formattedTables.length}`);
            console.log(`[Dashboard] Dynamic tables from orders: ${dynamicTables.length}`);
            console.log(`[Dashboard] Combined tables: ${allTables.length}`);

            // Assign orders to tables using the map
            const tablesWithOrders = allTables.map(table => {
                const tableOrdersList = tableOrdersMap[table.id] || []; // Use table.id for lookup
                let oldestOrderDate = null;
                if (tableOrdersList.length > 0) {
                    oldestOrderDate = tableOrdersList
                        .map(o => o.currentStatus?.date)
                        .filter(Boolean) // Ensure date exists before parsing/comparing
                        .reduce((oldest, current) => {
                            const oldestD = parseDate(oldest);
                            const currentD = parseDate(current);
                            // Handle cases where parseDate might return null
                            if (!currentD) return oldest;
                            if (!oldestD) return current;
                            return oldestD < currentD ? oldest : current;
                        }); // No need for initial value if we filter nulls first
                }

                return {
                    ...table,
                    orders: tableOrdersList,
                    duration: oldestOrderDate ? getTimeDuration(oldestOrderDate) : null
                };
            });

            // Assign orders to channels using the map
            const channelsWithOrders = orderChannels.map(channel => {
                const channelOrdersList = channelOrdersMap[channel.id] || []; // Use channel.id (variant title) for lookup
                let oldestOrderDate = null;
                if (channelOrdersList.length > 0) {
                    oldestOrderDate = channelOrdersList
                        .map(o => o.currentStatus?.date)
                        .filter(Boolean)
                        .reduce((oldest, current) => {
                            const oldestD = parseDate(oldest);
                            const currentD = parseDate(current);
                            if (!currentD) return oldest;
                            if (!oldestD) return current;
                            return oldestD < currentD ? oldest : current;
                        });
                }

                return {
                    ...channel,
                    orders: channelOrdersList,
                    duration: oldestOrderDate ? getTimeDuration(oldestOrderDate) : null
                };
            });

            // Update state
            setTables(tablesWithOrders);
            setChannels(channelsWithOrders);

            // Update dashboard metrics (use all fetched orders for metrics)
            // Ensure calculateDashboardMetrics can handle the 'orders' state format
            const metrics = calculateDashboardMetrics(orders);
            setDashboardMetrics(metrics);
        } catch (err) {
            console.error('Error processing orders:', err);
            setError('Failed to process orders data');
        }
        // Update dependencies: Now depends on 'seller' and the locally fetched 'kitchenOrders'
    }, [seller, kitchenOrders]);

    // Fetch orders based on current filter
    useEffect(() => {
        if (showCompletedOrders) {
            // Clean up any existing completed orders listener before creating a new one
            if (completedOrdersUnsubscribe) {
                completedOrdersUnsubscribe();
            }
            // Set up the listener for completed orders
            setupCompletedOrdersListener();
        }
    }, [dateFilter, customDateRange, showCompletedOrders]);

    // Function to show the add table modal
    const showAddTableModal = () => {
        // Check if ModalManager is available
        if (ModalManager) {
            // Use ModalManager directly
            const modalId = 'add-table-modal-' + Date.now();
            const content = `
                <div id="add-table-form">
                    <div id="add-table-error-container" class="mb-4 hidden p-3 bg-red-50 text-red-700 rounded-md"></div>
                    <div class="mb-6">
                        <label class="block text-gray-700 mb-2" for="table-title">
                            Title
                        </label>
                        <input
                            type="text"
                            id="table-title"
                            class="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="eg. T1"
                        />
                    </div>
                    <div class="mb-6">
                        <label class="block text-gray-700 mb-2" for="table-desc">
                            Description (optional)
                        </label>
                        <input
                            type="text"
                            id="table-desc"
                            class="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="eg. Corner Table"
                        />
                    </div>
                </div>
            `;

            const actions = `
                <div class="flex justify-end gap-3">
                    <button
                        id="cancel-add-table"
                        type="button"
                        class="px-4 py-2 border rounded-md hover:bg-gray-50"
                    >
                        Cancel
                    </button>
                    <button
                        id="save-add-table"
                        type="button"
                        class="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                    >
                        Add Table
                    </button>
                </div>
            `;

            const modal = ModalManagerCenterModal({
                id: modalId,
                title: "Add Table",
                content: content,
                actions: actions,
                onShown: (modalControl) => {
                    const titleInput = document.getElementById('table-title');
                    const descInput = document.getElementById('table-desc');
                    const errorContainer = document.getElementById('add-table-error-container');
                    const cancelButton = document.getElementById('cancel-add-table');
                    const saveButton = document.getElementById('save-add-table');

                    if (titleInput && cancelButton && saveButton) {
                        titleInput.focus();

                        cancelButton.addEventListener('click', () => {
                            modalControl.close();
                        });

                        saveButton.addEventListener('click', async () => {
                            const newTitle = titleInput.value.trim();
                            const newDesc = descInput.value.trim();

                            // Validate form
                            if (!newTitle) {
                                errorContainer.textContent = 'Please enter a title';
                                errorContainer.classList.remove('hidden');
                                return;
                            }

                            try {
                                // Get current tables
                                const currentTables = seller?.tables || [];

                                // Check if table already exists
                                if (currentTables.some(t => t.title === newTitle)) {
                                    errorContainer.textContent = 'A table with this name already exists';
                                    errorContainer.classList.remove('hidden');
                                    return;
                                }

                                // Add the new table
                                const updatedTables = [...currentTables, { title: newTitle, desc: newDesc }];

                                // Update seller document in Firestore
                                await sdk.profile.update({
                                    tables: updatedTables
                                });

                                ModalManagerast('Table added successfully');
                                modalControl.close();
                            } catch (err) {
                                console.error('Error adding table:', err);
                                errorContainer.textContent = 'Failed to add table. Please try again.';
                                errorContainer.classList.remove('hidden');
                            }
                        });
                    }
                }
            });
        } else {
            // Fallback to original React component modal
            setIsAddTableModalOpen(true);
        }
    };

    // Function to show the rename room modal
    const showRenameRoomModal = (tableId, variant) => {
        // Check if ModalManager is available
        if (ModalManager) {
            // Use ModalManager directly
            const modalId = 'rename-room-modal-' + Date.now();
            const initialTitle = tableId || variant || '';
            const modalTitle = tableId ? "Rename Table" : "Rename Channel";

            const content = `
                <div id="rename-room-form">
                    <div id="rename-error-container" class="mb-4 hidden p-3 bg-red-50 text-red-700 rounded-md"></div>
                    <div class="mb-6">
                        <label class="block text-gray-700 mb-2" for="room-title">
                            Title
                        </label>
                        <input
                            type="text"
                            id="room-title"
                            value="${initialTitle}"
                            class="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="eg. T1"
                        />
                    </div>
                </div>
            `;

            const actions = `
                <div class="flex justify-end gap-3">
                    <button
                        id="cancel-rename"
                        type="button"
                        class="px-4 py-2 border rounded-md hover:bg-gray-50"
                    >
                        Cancel
                    </button>
                    <button
                        id="save-rename"
                        type="button"
                        class="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                    >
                        Save
                    </button>
                </div>
            `;

            const modal = ModalManagerCenterModal({
                id: modalId,
                title: modalTitle,
                content: content,
                actions: actions,
                onShown: (modalControl) => {
                    const titleInput = document.getElementById('room-title');
                    const errorContainer = document.getElementById('rename-error-container');
                    const cancelButton = document.getElementById('cancel-rename');
                    const saveButton = document.getElementById('save-rename');

                    if (titleInput && cancelButton && saveButton) {
                        titleInput.focus();
                        titleInput.select();

                        cancelButton.addEventListener('click', () => {
                            modalControl.close();
                        });

                        saveButton.addEventListener('click', async () => {
                            const newTitle = titleInput.value.trim();

                            // Validate form
                            if (!newTitle) {
                                errorContainer.textContent = 'Please enter a title';
                                errorContainer.classList.remove('hidden');
                                return;
                            }

                            try {
                                if (variant) {
                                    // Rename price variant
                                    const vars = seller?.priceVariants || [];
                                    const index = vars.findIndex(v => v.title === variant);

                                    if (index === -1) {
                                        errorContainer.textContent = "Can't rename this default room";
                                        errorContainer.classList.remove('hidden');
                                        return;
                                    }

                                    const updatedVars = [...vars];
                                    updatedVars[index] = { title: newTitle };

                                    await sdk.profile.update({ priceVariants: updatedVars });
                                } else if (tableId) {
                                    // Rename table
                                    const tables = seller?.tables || [];
                                    const index = tables.findIndex(t => t.title === tableId);

                                    if (index === -1) {
                                        errorContainer.textContent = "Can't rename this table";
                                        errorContainer.classList.remove('hidden');
                                        return;
                                    }

                                    const updatedTables = [...tables];
                                    updatedTables[index] = { ...updatedTables[index], title: newTitle };

                                    await sdk.profile.update({ tables: updatedTables });
                                } else {
                                    errorContainer.textContent = "Can't rename room";
                                    errorContainer.classList.remove('hidden');
                                    return;
                                }

                                ModalManagerast('Renamed successfully');
                                modalControl.close();
                            } catch (err) {
                                console.error('Error renaming:', err);
                                errorContainer.textContent = 'Failed to rename. Please try again.';
                                errorContainer.classList.remove('hidden');
                            }
                        });
                    }
                }
            });
        } else {
            // Fallback to original React component modal
            setSelectedTableId(tableId);
            setSelectedVariant(variant);
            setIsRenameRoomModalOpen(true);
        }
    };

    // Function to remove a table
    const removeTable = async (tableId) => {
        try {
            // Use confirmDialog utility instead of native confirm
            confirmDialog({
                title: 'Remove Table',
                content: `Are you sure you want to remove table ${tableId}?`,
                confirmText: 'Remove',
                cancelText: 'Cancel',
                onConfirm: async () => {
                    try {
                        // Get current tables from seller
                        const currentTables = seller?.tables || [];

                        // Remove the table
                        const updatedTables = currentTables.filter(table => table.title !== tableId);

                        // Update seller document in Firestore
                        await sdk.profile.update({
                            tables: updatedTables
                        });

                        // Trigger UI refresh
                        if (refreshTables && typeof refreshTables === 'function') {
                            refreshTables();
                        }

                        showToast('Table removed successfully');

                        // Analytics tracking (if needed)
                        // analytics.track("REMOVE_TABLE");
                    } catch (err) {
                        console.error('Error removing table:', err);
                        showToast('Failed to remove table. Please try again.');
                    }
                }
            });
        } catch (err) {
            console.error('Error in confirm dialog:', err);
            showToast('An error occurred. Please try again.');
        }
    };

    // Helper function to calculate start date based on filter
    const calculateStartDate = (filter, customStart = null) => {
        const now = new Date();
        const customStartDate = parseDate(customStart);

        switch (filter) {
            case 'today':
                return new Date(now.getFullYear(), now.getMonth(), now.getDate());
            case 'yesterday':
                const yesterday = new Date(now);
                yesterday.setDate(yesterday.getDate() - 1);
                return new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate());
            case '7days':
                const sevenDaysAgo = new Date(now);
                sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
                return new Date(sevenDaysAgo.getFullYear(), sevenDaysAgo.getMonth(), sevenDaysAgo.getDate());
            case '30days':
                const thirtyDaysAgo = new Date(now);
                thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 29);
                return new Date(thirtyDaysAgo.getFullYear(), thirtyDaysAgo.getMonth(), thirtyDaysAgo.getDate());
            case 'custom':
                return customStartDate || now;
            default:
                return new Date(now.getFullYear(), now.getMonth(), now.getDate());
        }
    };

    // Helper function to calculate end date based on filter
    const calculateEndDate = (filter, customEnd = null) => {
        const now = new Date();
        const customEndDate = parseDate(customEnd);

        switch (filter) {
            case 'today':
                return now;
            case 'yesterday':
                const yesterday = new Date(now);
                yesterday.setDate(yesterday.getDate() - 1);
                return new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 23, 59, 59);
            case '7days':
                return now;
            case '30days':
                return now;
            case 'custom':
                return customEndDate || now;
            default:
                return now;
        }
    };

    // Handle room click
    const handleRoomClick = (tableId, variant) => {
        setSelectedRoomTableId(tableId);
        setSelectedRoomVariant(variant);
        setIsOrderRoomOpen(true);

        // Enhanced debugging for OrderRoom
        console.log(`[Dashboard] Opening OrderRoom for ${tableId ? `Table ${tableId}` : variant || 'Default'} showing KITCHEN status orders`);

        // Check what data we're sending to OrderRoom
        if (getOrdersForSource) {
            const previewOrders = getOrdersForSource(tableId, variant, "KITCHEN");
            console.log(`[Dashboard] Preview: OrderRoom will receive ${previewOrders.length} orders for ${tableId ? `Table ${tableId}` : variant || 'Default'}`);

            if (previewOrders.length === 0 && variant === 'Swiggy') {
                // Special case for Swiggy which shows in tile but not in OrderRoom
                console.log(`[Dashboard] WARNING: Swiggy channel shows 0 orders in preview. This may indicate a data inconsistency!`);
                console.log(`[Dashboard] Checking all KITCHEN orders for Swiggy data...`);

                const allKitchenOrders = kitchenOrders.filter(o =>
                    (o.priceVariant === 'Swiggy' || o.tableId === 'Swiggy') &&
                    o.currentStatus?.label === 'KITCHEN'
                );

                console.log(`[Dashboard] Found ${allKitchenOrders.length} raw KITCHEN status orders with Swiggy data`);
                if (allKitchenOrders.length > 0) {
                    console.log(`[Dashboard] First Swiggy order:`, {
                        id: allKitchenOrders[0].id,
                        tableId: allKitchenOrders[0].tableId || null,
                        priceVariant: allKitchenOrders[0].priceVariant || null,
                        status: allKitchenOrders[0].currentStatus?.label,
                        items: allKitchenOrders[0].items?.length || 0
                    });
                }
            }
        }
    };

    // Calculate dashboard metrics from orders data
    const calculateDashboardMetrics = (allOrders) => {
        try {
            if (!allOrders || !Array.isArray(allOrders)) {
                console.error('[Dashboard Metrics] Invalid orders data:', allOrders);
                return {
                    todayOrders: 0,
                    todayRevenue: 0,
                    newCustomers: 0,
                    avgOrderValue: 0,
                    avgServiceTime: 0,
                    todayOrdersTrend: 0,
                    todayRevenueTrend: 0,
                    newCustomersTrend: 0,
                    avgOrderValueTrend: 0,
                    avgServiceTimeTrend: 0
                };
            }

            // Ensure we don't have duplicate orders by filtering based on ID
            const uniqueOrderIds = new Set();
            const uniqueOrders = allOrders.filter(order => {
                if (!order.id) return false;
                if (uniqueOrderIds.has(order.id)) return false;
                uniqueOrderIds.add(order.id);
                return true;
            });

            console.log(`[Dashboard Metrics] Calculating metrics from ${uniqueOrders.length} unique orders (filtered from ${allOrders.length} total)`);

            // Create date objects for today and yesterday
            const now = new Date();
            const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const startOfYesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);

            // Filter orders for today and yesterday - ensure exact match with Analytics page
            const todayOrders = uniqueOrders.filter(order => {
                // Get order date, ensuring proper handling of Firebase timestamps
                const orderDate = order.date?.toDate ? order.date.toDate() : new Date(order.date);
                return orderDate && orderDate >= startOfToday;
            });

            const yesterdayOrders = uniqueOrders.filter(order => {
                // Get order date, ensuring proper handling of Firebase timestamps
                const orderDate = order.date?.toDate ? order.date.toDate() : new Date(order.date);
                return orderDate && orderDate >= startOfYesterday && orderDate < startOfToday;
            });

            console.log(`[Dashboard Metrics] Found ${todayOrders.length} orders for today and ${yesterdayOrders.length} for yesterday`);

            // Calculate today's metrics
            const todayOrdersCount = todayOrders.length;

            // Calculate revenue (include all orders for now, not just paid)
            const todayRevenue = todayOrders.reduce((sum, order) => {
                // Calculate total from items
                const itemsTotal = order.items?.reduce((total, item) => {
                    const price = Number(item.price) || 0;
                    const quantity = Number(item.quantity || item.qnt || 1);
                    return total + (price * quantity);
                }, 0) || 0;

                return sum + itemsTotal;
            }, 0);

            console.log(`[Dashboard Metrics] Today's revenue: ${todayRevenue}`);

            // Calculate yesterday's metrics for trend comparison
            const yesterdayOrdersCount = yesterdayOrders.length;
            const yesterdayRevenue = yesterdayOrders.reduce((sum, order) => {
                const itemsTotal = order.items?.reduce((total, item) => {
                    const price = Number(item.price) || 0;
                    const quantity = Number(item.quantity || item.qnt || 1);
                    return total + (price * quantity);
                }, 0) || 0;

                return sum + itemsTotal;
            }, 0);

            // Get unique customer count for today
            const todayCustomerIds = new Set(todayOrders
                .filter(order => order.customer?.id)
                .map(order => order.customer.id));
            const newCustomersCount = todayCustomerIds.size;

            // Yesterday's unique customers
            const yesterdayCustomerIds = new Set(yesterdayOrders
                .filter(order => order.customer?.id)
                .map(order => order.customer.id));
            const yesterdayNewCustomersCount = yesterdayCustomerIds.size;

            // Calculate average order value for today's orders
            const avgOrderValue = todayOrdersCount > 0
                ? todayRevenue / todayOrdersCount
                : 0;

            // Calculate avg order value for yesterday
            const yesterdayAvgOrderValue = yesterdayOrdersCount > 0
                ? yesterdayRevenue / yesterdayOrdersCount
                : 1; // Avoid division by zero in trend calculation

            // Calculate service time (from PLACED to COMPLETED)
            let totalServiceTimeMinutes = 0;
            let serviceTimeOrderCount = 0;

            todayOrders.forEach(order => {
                if (order.status && Array.isArray(order.status)) {
                    const placedStatus = order.status.find(s => s.label === "PLACED");
                    const completedStatus = order.status.find(s => s.label === "COMPLETED");

                    if (placedStatus && completedStatus && placedStatus.date && completedStatus.date) {
                        // Ensure proper date handling for both timestamps
                        const placedDate = placedStatus.date?.toDate ? placedStatus.date.toDate() : new Date(placedStatus.date);
                        const completedDate = completedStatus.date?.toDate ? completedStatus.date.toDate() : new Date(completedStatus.date);

                        if (placedDate && completedDate) {
                            const serviceTimeMinutes = (completedDate - placedDate) / (1000 * 60);
                            if (serviceTimeMinutes > 0 && serviceTimeMinutes < 1440) { // Less than a day
                                totalServiceTimeMinutes += serviceTimeMinutes;
                                serviceTimeOrderCount++;
                            }
                        }
                    }
                }
            });

            const avgServiceTime = serviceTimeOrderCount > 0
                ? totalServiceTimeMinutes / serviceTimeOrderCount
                : 0;

            // Calculate trends (percentage change from yesterday)
            const calculateTrend = (today, yesterday) => {
                if (yesterday === 0) return today > 0 ? 100 : 0;
                return ((today - yesterday) / yesterday) * 100;
            };

            const todayOrdersTrend = calculateTrend(todayOrdersCount, yesterdayOrdersCount);
            const todayRevenueTrend = calculateTrend(todayRevenue, yesterdayRevenue);
            const newCustomersTrend = calculateTrend(newCustomersCount, yesterdayNewCustomersCount);
            const avgOrderValueTrend = calculateTrend(avgOrderValue, yesterdayAvgOrderValue);

            // For service time, a negative trend is actually good (faster service)
            let avgServiceTimeTrend = 0;

            // Calculate yesterday's average service time
            let yesterdayTotalServiceTimeMinutes = 0;
            let yesterdayServiceTimeOrderCount = 0;

            yesterdayOrders.forEach(order => {
                if (order.status && Array.isArray(order.status)) {
                    const placedStatus = order.status.find(s => s.label === "PLACED");
                    const completedStatus = order.status.find(s => s.label === "COMPLETED");

                    if (placedStatus && completedStatus && placedStatus.date && completedStatus.date) {
                        // Ensure proper date handling for both timestamps
                        const placedDate = placedStatus.date?.toDate ? placedStatus.date.toDate() : new Date(placedStatus.date);
                        const completedDate = completedStatus.date?.toDate ? completedStatus.date.toDate() : new Date(completedStatus.date);

                        if (placedDate && completedDate) {
                            const serviceTimeMinutes = (completedDate - placedDate) / (1000 * 60);
                            if (serviceTimeMinutes > 0 && serviceTimeMinutes < 1440) { // Less than a day
                                yesterdayTotalServiceTimeMinutes += serviceTimeMinutes;
                                yesterdayServiceTimeOrderCount++;
                            }
                        }
                    }
                }
            });

            const yesterdayAvgServiceTime = yesterdayServiceTimeOrderCount > 0
                ? yesterdayTotalServiceTimeMinutes / yesterdayServiceTimeOrderCount
                : 1; // Avoid division by zero

            // For service time, a negative trend is actually good (faster service)
            avgServiceTimeTrend = calculateTrend(avgServiceTime, yesterdayAvgServiceTime) * -1;

            const result = {
                todayOrders: todayOrdersCount,
                todayRevenue: todayRevenue,
                newCustomers: newCustomersCount,
                avgOrderValue: avgOrderValue,
                avgServiceTime: avgServiceTime,
                todayOrdersTrend: todayOrdersTrend,
                todayRevenueTrend: todayRevenueTrend,
                newCustomersTrend: newCustomersTrend,
                avgOrderValueTrend: avgOrderValueTrend,
                avgServiceTimeTrend: avgServiceTimeTrend
            };

            console.log('[Dashboard Metrics] Calculated metrics:', result);
            return result;
        } catch (err) {
            console.error('Error calculating dashboard metrics:', err);
            return {
                todayOrders: 0,
                todayRevenue: 0,
                newCustomers: 0,
                avgOrderValue: 0,
                avgServiceTime: 0,
                todayOrdersTrend: 0,
                todayRevenueTrend: 0,
                newCustomersTrend: 0,
                avgOrderValueTrend: 0,
                avgServiceTimeTrend: 0
            };
        }
    };

    // Check SDK availability when component mounts
    useEffect(() => {
        if (!sdk || !sdk.db.collection) {
            console.error("SDK is not available or not properly initialized");
            setError("SDK is not available. Some features may not work properly.");
        }
    }, []);

    // Fetch QR orders and set up real-time listeners
    useEffect(() => {
        // Initial fetch for PLACED orders (QR tab)
        setupPlacedOrdersListener();

        // Set up real-time listener for KITCHEN orders
        setupKitchenOrdersListener();

        // Cleanup listeners on component unmount
        return () => {
            // Clean up Firestore listeners
            if (kitchenOrdersUnsubscribe) {
                kitchenOrdersUnsubscribe();
            }
            if (completedOrdersUnsubscribe) {
                completedOrdersUnsubscribe();
            }
            if (placedOrdersUnsubscribe) {
                placedOrdersUnsubscribe();
            }
        };
    }, []); // Empty dependency array means this runs once on mount

    // Set up real-time listener for KITCHEN orders
    const setupKitchenOrdersListener = () => {
        try {
            // Check if SDK is available
            if (!sdk || !sdk.db.collection) {
                console.error("SDK is not available or not properly initialized");
                setError("SDK is not available. Please try again later.");
                return;
            }

            console.log("[Kitchen Listener] Setting up real-time listener for KITCHEN orders");

            // Query for KITCHEN orders - mirrors the Flutter implementation
            const kitchenQuery = sdk.db.collection("Orders")
                .where("currentStatus.label", "==", "KITCHEN")
                .orderBy("date", "desc")
                .limit(100); // Increased limit for better pagination

            // Set up real-time listener
            const unsubscribe = kitchenQuery.onSnapshot(
                (snapshot) => {
                    // Process the snapshot data
                    const kitchenOrdersData = snapshot.docs
                        .map(doc => ({
                            id: doc.id,
                            ...doc.data(),
                            date: parseDate(doc.data().date),
                            // Parse status dates properly
                            status: Array.isArray(doc.data().status)
                                ? doc.data().status.map(s => ({
                                    ...s,
                                    date: parseDate(s.date)
                                }))
                                : []
                        }))
                        .filter(order => order.items && order.items.length > 0);

                    console.log(`[Kitchen Listener] Received ${kitchenOrdersData.length} KITCHEN orders`);

                    // Update state with the real-time KITCHEN orders data
                    setKitchenOrders(kitchenOrdersData);

                    // Also fetch recent COMPLETED orders for metrics
                    fetchRecentCompletedOrders(kitchenOrdersData);

                    console.log(`[Realtime update] ${kitchenOrdersData.length} KITCHEN orders (real-time listener active)`);
                },
                (error) => {
                    console.error('Error in KITCHEN orders listener:', error);
                    setError(`Failed to listen to kitchen orders updates: ${error.message}`);
                }
            );

            // Save the unsubscribe function
            setKitchenOrdersUnsubscribe(() => unsubscribe);
        } catch (err) {
            console.error('Error setting up kitchen orders listener:', err);
            setError('Failed to set up kitchen orders listener');
        }
    };

    // Fetch recent COMPLETED orders for metrics only
    const fetchRecentCompletedOrders = async (kitchenOrdersData) => {
        try {
            // Check if SDK is available
            if (!sdk || !sdk.db.collection) {
                console.error("SDK is not available or not properly initialized");
                return;
            }

            // Get start of today for metrics calculation
            const now = new Date();
            const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const startOfYesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);

            // Fetch ALL recent orders for metrics (both COMPLETED and other statuses for today/yesterday)
            const recentCompletedQuery = sdk.db.collection("Orders")
                .orderBy("date", "desc")
                .where("date", ">=", startOfYesterday) // Get at least yesterday's orders
                .limit(300); // Increased limit to ensure we get all relevant orders

            const completedSnapshot = await recentCompletedQuery.get();

            const completedOrdersData = completedSnapshot.docs.map(doc => {
                const data = doc.data();
                return {
                    id: doc.id,
                    ...data,
                    // Ensure date is properly parsed from Firestore timestamps
                    date: parseDate(data.date),
                    // Parse status dates properly
                    status: Array.isArray(data.status)
                        ? data.status.map(s => ({
                            ...s,
                            date: parseDate(s.date)
                        }))
                        : []
                };
            });

            console.log(`[Dashboard Metrics] Fetched ${completedOrdersData.length} orders for metrics calculation`);

            // Log date ranges for debugging
            console.log(`[Dashboard Metrics] Today starts at: ${startOfToday.toISOString()}`);
            console.log(`[Dashboard Metrics] Yesterday starts at: ${startOfYesterday.toISOString()}`);

            // Count how many orders are from today for debugging
            const todayOrdersCount = completedOrdersData.filter(order => {
                // Ensure proper handling of Firebase timestamps
                const orderDate = order.date?.toDate ? order.date.toDate() : new Date(order.date);
                return orderDate && orderDate >= startOfToday;
            }).length;

            console.log(`[Dashboard Metrics] Orders from today: ${todayOrdersCount}`);

            // Create a Set of IDs from kitchenOrdersData for efficient lookup
            const kitchenOrderIds = new Set(kitchenOrdersData.map(order => order.id));
            
            // Filter out any orders from completedOrdersData that already exist in kitchenOrdersData
            const uniqueCompletedOrders = completedOrdersData.filter(order => !kitchenOrderIds.has(order.id));
            
            console.log(`[Dashboard Metrics] Filtered out ${completedOrdersData.length - uniqueCompletedOrders.length} duplicate orders`);

            // Combine KITCHEN and unique completed orders for the metrics state
            const allMetricsOrders = [...kitchenOrdersData, ...uniqueCompletedOrders];
            setOrders(allMetricsOrders);

            // Calculate metrics immediately instead of waiting for state update
            const metrics = calculateDashboardMetrics(allMetricsOrders);
            setDashboardMetrics(metrics);

            console.log(`[Dashboard Metrics] Updated metrics:`, metrics);
        } catch (err) {
            console.error('Error fetching orders for metrics:', err);
        }
    };

    // Set up real-time listener for PLACED orders
    const setupPlacedOrdersListener = () => {
        try {
            setLoadingQrOrders(true);
            setErrorQrOrders(null);

            // Check if SDK is available
            if (!sdk || !sdk.db.collection) {
                console.error("SDK is not available or not properly initialized");
                setErrorQrOrders("SDK is not available. Please try again later.");
                setLoadingQrOrders(false);
                return;
            }

            console.log("[PLACED Listener] Setting up real-time listener for PLACED orders");

            // Query for PLACED orders - similar to the KITCHEN orders listener
            const placedQuery = sdk.db.collection("Orders")
                .where("currentStatus.label", "==", "PLACED")
                .orderBy("date", "desc")
                .limit(100); // Increased limit for better pagination

            // Set up real-time listener
            const unsubscribe = placedQuery.onSnapshot(
                (snapshot) => {
                    // Process the snapshot data
                    const placedOrdersData = snapshot.docs
                        .map(doc => ({
                            id: doc.id,
                            ...doc.data(),
                            date: parseDate(doc.data().date)
                        }));

                    // Update state with the real-time PLACED orders data
                    setQrOrders(placedOrdersData);
                    setLoadingQrOrders(false);

                    console.log(`[Realtime update] ${placedOrdersData.length} PLACED orders (real-time listener active)`);
                },
                (error) => {
                    console.error('Error in PLACED orders listener:', error);
                    setErrorQrOrders(`Failed to listen to QR orders updates: ${error.message}`);
                    setLoadingQrOrders(false);
                }
            );

            // Save the unsubscribe function
            setPlacedOrdersUnsubscribe(() => unsubscribe);
        } catch (err) {
            console.error('Error setting up PLACED orders listener:', err);
            setErrorQrOrders(`Failed to set up PLACED orders listener: ${err.message}`);
            setLoadingQrOrders(false);
        }
    };

    // Keep the handleAcceptOrder function for accepting orders
    const handleAcceptOrder = async (orderId) => {
        try {
            setLoadingQrOrders(true);

            // Check if SDK is available
            if (!sdk || !sdk.db.collection) {
                throw new Error('SDK is not available or not properly initialized');
            }

            // Fetch the order first to log its current state
            const orderRef = sdk.db.collection("Orders").doc(orderId);
            const orderDoc = await orderRef.get();

            if (!orderDoc.exists) {
                throw new Error(`Order ${orderId} not found`);
            }

            const orderData = orderDoc.data();
            console.log(`[handleAcceptOrder] Before update - Order ${orderId}:`, {
                tableId: orderData.tableId || 'null/undefined',
                priceVariant: orderData.priceVariant || 'null/undefined',
                currentStatus: orderData.currentStatus,
                statusCount: orderData.status?.length || 0
            });

            // Get occupied tables from multiple sources to ensure accuracy
            const occupiedTableIds = new Set();
            
            // 1. Check tables from the tables state which already has occupancy info
            tables.forEach(table => {
                if (table.isTable && (table.orders?.length > 0 || table.isOccupied)) {
                    occupiedTableIds.add(table.id);
                }
            });
            
            // 2. Check all orders with KITCHEN or PLACED status
            try {
                const kitchenOrdersSnapshot = await sdk.db.collection("Orders")
                    .where("currentStatus.label", "in", ["KITCHEN", "PLACED"])
                    .get();
                    
                kitchenOrdersSnapshot.forEach(doc => {
                    const data = doc.data();
                    if (data.tableId) {
                        occupiedTableIds.add(data.tableId);
                    }
                });
            } catch (err) {
                console.error("Error fetching orders for table occupancy:", err);
                // Continue execution even if this fails
            }
            
            // 3. Check specifically for tables that might be reserved or marked as occupied in the profile
            if (profileTables) {
                profileTables.forEach(table => {
                    if (table.isOccupied || table.status === 'occupied' || table.reserved) {
                        occupiedTableIds.add(table.id || table.title);
                    }
                });
            }
            
            console.log(`[handleAcceptOrder] Found ${occupiedTableIds.size} occupied tables:`, Array.from(occupiedTableIds));

            // Open a modal to select a table
            ModalManager.createCenterModal({
                id: 'select-table-modal',
                title: 'Select Table for Order',
                content: `
                    <div class="p-4">
                        <p class="mb-4 text-gray-700">Select an available table to assign this QR order:</p>
                        <div class="mb-3">
                            <span class="inline-flex items-center mr-4">
                                <span class="w-3 h-3 rounded-full bg-green-500 mr-1"></span>
                                <span class="text-sm">Available</span>
                            </span>
                            <span class="inline-flex items-center">
                                <span class="w-3 h-3 rounded-full bg-red-500 mr-1"></span>
                                <span class="text-sm">Occupied</span>
                            </span>
                        </div>
                        <div id="table-selection-container" class="grid grid-cols-2 md:grid-cols-3 gap-3 max-h-[50vh] overflow-y-auto">
                            <div class="animate-pulse flex space-x-4">
                                <div class="flex-1 space-y-4 py-1">
                                    <div class="h-20 bg-gray-200 rounded"></div>
                                    <div class="h-20 bg-gray-200 rounded"></div>
                                </div>
                            </div>
                        </div>
                    </div>
                `,
                actions: [
                    {
                        label: 'Cancel',
                        type: 'secondary',
                        onClick: (modalControl) => {
                            modalControl.close();
                            setLoadingQrOrders(false);
                        }
                    }
                ],
                onShown: async (modalControl) => {
                    try {
                        // Get tables from profile
                        const tableContainer = document.getElementById('table-selection-container');
                        
                        if (!tableContainer) {
                            throw new Error('Table container element not found');
                        }

                        // Clear loading state
                        tableContainer.innerHTML = '';

                        // If no tables available, show message
                        if (!profileTables || profileTables.length === 0) {
                            tableContainer.innerHTML = `
                                <div class="col-span-full text-center py-6">
                                    <i class="ph ph-table text-gray-400 text-3xl mb-2"></i>
                                    <p class="text-gray-500">No tables available</p>
                                </div>
                            `;
                            return;
                        }

                        // Refresh the occupied tables list one more time from the DOM
                        // This is a fallback to ensure we capture the most current state
                        try {
                            const tableElements = document.querySelectorAll('[data-table-id]');
                            tableElements.forEach(el => {
                                const tableId = el.getAttribute('data-table-id');
                                const hasOrderIndicator = el.querySelector('.order-indicator');
                                const hasRedBg = el.classList.contains('bg-red-50') || 
                                               el.classList.contains('bg-red-100') || 
                                               el.classList.contains('border-red-200');
                                
                                if ((hasOrderIndicator || hasRedBg) && tableId) {
                                    occupiedTableIds.add(tableId);
                                }
                            });
                        } catch (domErr) {
                            console.error("Error checking DOM for table status:", domErr);
                        }

                        // Add tables to the container
                        profileTables.forEach(table => {
                            const tableId = table.id || table.title;
                            // Check if table is occupied from our comprehensive set
                            const isOccupied = occupiedTableIds.has(tableId);
                            
                            // Determine table status and styling
                            const statusColor = isOccupied ? 'red' : 'green';
                            const statusText = isOccupied ? 'Occupied' : 'Available';
                            const bgClass = isOccupied 
                                ? 'bg-red-50 border-red-200' 
                                : 'bg-gradient-to-br from-warm-bg to-white border-gray-200 hover:shadow-md';
                            const cursorClass = isOccupied ? 'cursor-not-allowed' : 'cursor-pointer';
                            
                            const tableElement = document.createElement('div');
                            tableElement.className = `rounded-xl p-3 border ${bgClass} ${cursorClass} transition-all`;
                            tableElement.setAttribute('data-table-id', tableId);
                            tableElement.innerHTML = `
                                <div class="flex items-center justify-between mb-2">
                                    <h3 class="text-sm font-bold truncate max-w-[70%]">${table.title}</h3>
                                    <div class="w-8 h-8 rounded-lg bg-gradient-to-br from-white to-white/80 flex items-center justify-center shadow-sm">
                                        <i class="ph ph-table text-${statusColor}-500 text-sm"></i>
                                    </div>
                                </div>
                                <div class="flex items-center">
                                    <span class="text-xs text-${statusColor}-500 font-medium ${isOccupied ? 'order-indicator' : ''}">
                                        <i class="ph ph-circle-fill text-${statusColor}-500 mr-1 text-xs"></i>
                                        ${statusText}
                                    </span>
                                </div>
                            `;
                            
                            // Add click handler only for available tables
                            if (!isOccupied) {
                                                            tableElement.addEventListener('click', async () => {
                                try {
                                    modalControl.close();
                                    
                                    // Create status entry for kitchen processing
                                    const statusEntry = {
                                        label: 'KITCHEN',
                                        date: new Date()
                                    };

                                    // Log using safeLog instead of console.log
                                    safeLog.info(`[handleAcceptOrder] Assigning order ${orderId} to table ${tableId}`);

                                    // Update the order status AND assign to table
                                    // Check if Firebase is available in the window object
                                    if (window.firebase && window.firebase.firestore) {
                                        // Use Firebase directly if available
                                        await orderRef.update({
                                            tableId: tableId,
                                            currentStatus: statusEntry,
                                            status: window.firebase.firestore.FieldValue.arrayUnion(statusEntry)
                                        });
                                    } else if (sdk.db && sdk.db.FieldValue && sdk.db.FieldValue.arrayUnion) {
                                        // Try SDK's db.FieldValue if available
                                        await orderRef.update({
                                            tableId: tableId,
                                            currentStatus: statusEntry,
                                            status: sdk.db.FieldValue.arrayUnion(statusEntry)
                                        });
                                    } else {
                                        // Fallback: Get current status array and update manually
                                        const currentDoc = await orderRef.get();
                                        const currentData = currentDoc.data();
                                        const currentStatus = Array.isArray(currentData.status) ? currentData.status : [];
                                        
                                        await orderRef.update({
                                            tableId: tableId,
                                            currentStatus: statusEntry,
                                            status: [...currentStatus, statusEntry]
                                        });
                                    }

                                    // Fetch the updated order to confirm changes
                                    const updatedOrderDoc = await orderRef.get();
                                    const updatedOrderData = updatedOrderDoc.data();

                                    safeLog.info(`[handleAcceptOrder] After update - Order ${orderId} assigned to table ${tableId}`);

                                    // Show success message
                                    showToast(`Order accepted and assigned to table ${table.title}`);
                                    
                                    // Extra check - force refresh of kitchen orders listener
                                    safeLog.info("Refreshing kitchen orders listener to ensure the updated order appears...");
                                    
                                    try {
                                        if (kitchenOrdersUnsubscribe) {
                                            kitchenOrdersUnsubscribe();
                                        }
                                        setupKitchenOrdersListener();
                                    } catch (listenerErr) {
                                        safeLog.warn("Error refreshing kitchen orders listener:", listenerErr);
                                        // Continue execution even if listener refresh fails
                                    }
                                } catch (err) {
                                    safeLog.error('Error assigning order to table:', err);
                                    showToast(`Failed to assign order to table: ${err.message || 'Unknown error'}`, "error");
                                } finally {
                                    setLoadingQrOrders(false);
                                }
                            });
                            }
                            
                            tableContainer.appendChild(tableElement);
                        });
                    } catch (err) {
                        safeLog.error('Error loading tables:', err);
                        const tableContainer = document.getElementById('table-selection-container');
                        if (tableContainer) {
                            tableContainer.innerHTML = `
                                <div class="col-span-full text-center py-6">
                                    <i class="ph ph-warning text-red-500 text-3xl mb-2"></i>
                                    <p class="text-red-500">Error loading tables: ${err.message}</p>
                                </div>
                            `;
                        }
                    }
                }
            });
        } catch (err) {
            safeLog.error('Error accepting order:', err);
            showToast(`Failed to accept order: ${err.message}`, "error");
            setLoadingQrOrders(false);
        }
    };

    const handleRejectOrder = async (orderId) => {
        try {
            setLoadingQrOrders(true);

            // Check if SDK is available
            if (!sdk || !sdk.db.collection) {
                throw new Error('SDK is not available or not properly initialized');
            }

            // Create status entry for rejected
            const statusEntry = {
                label: 'CANCELLED',
                date: new Date()
            };

            // Update the order status directly without checking if it exists
            const orderRef = sdk.db.collection("Orders").doc(orderId);

            // Update with array union for atomicity
            if (window.firebase && window.firebase.firestore) {
                // Use Firebase directly if available
                await orderRef.update({
                    currentStatus: statusEntry,
                    status: window.firebase.firestore.FieldValue.arrayUnion(statusEntry)
                });
            } else if (sdk.db && sdk.db.FieldValue && sdk.db.FieldValue.arrayUnion) {
                // Try SDK's db.FieldValue if available
                await orderRef.update({
                    currentStatus: statusEntry,
                    status: sdk.db.FieldValue.arrayUnion(statusEntry)
                });
            } else {
                // Fallback: Get current status array and update manually
                const currentDoc = await orderRef.get();
                const currentData = currentDoc.data();
                const currentStatus = Array.isArray(currentData.status) ? currentData.status : [];
                
                await orderRef.update({
                    currentStatus: statusEntry,
                    status: [...currentStatus, statusEntry]
                });
            }

            // Show success message
            showToast("Order rejected successfully");
        } catch (err) {
            safeLog.error('Error rejecting order:', err);
            showToast(`Failed to reject order: ${err.message}`, "error");
        } finally {
            setLoadingQrOrders(false);
        }
    };

    // Add releaseTable function after handlePrintBill
    const handlePrintBill = async (orderId) => {
        try {
            // Check if SDK is available
            if (!sdk || !sdk.db.collection) {
                throw new Error('SDK is not available or not properly initialized');
            }

            console.log(`[Dashboard] Attempting to print bill for order: ${orderId}`);

            // Check if bill printing is available in SDK and print directly without checking if order exists
            if (sdk.bill && typeof sdk.bill.print === 'function') {
                console.log(`[Dashboard] Using SDK bill.print function`);
                await sdk.bill.print(orderId);
                showToast("Bill printed successfully");
            } else if (BluetoothPrinting && PrintTemplate) {
                // Use our own implementation with PrintTemplate and BluetoothPrinting
                console.log(`[Dashboard] Using BluetoothPrinting with PrintTemplate`);

                try {
                    // Fetch the order data
                    const orderDoc = await sdk.db.collection("Orders").doc(orderId).get();
                    const orderData = orderDoc.data();

                    if (!orderData) {
                        throw new Error("Order not found");
                    }

                    // Print the bill using BluetoothPrinting
                    const success = await BluetoothPrinting.printBill(orderId);

                    if (success) {
                        showToast("Bill printed successfully");
                    } else {
                        throw new Error("Printing failed");
                    }
                } catch (printError) {
                    safeLog.error('Error in BluetoothPrinting:', printError);
                    throw printError;
                }
            } else if (sdk.kot && typeof sdk.kot.print === 'function') {
                // Fallback to KOT printing if bill printing is not available
                console.log(`[Dashboard] Bill print not available, falling back to KOT print`);
                await sdk.kot.print(orderId);
                showToast("KOT printed successfully");
            } else {
                // Fallback for development/testing
                console.log('[Dashboard] Print simulation for order:', orderId);
                showToast("Print simulation: Bill printed successfully");
            }
        } catch (err) {
            safeLog.error('Error printing bill:', err);
            showToast(`Failed to print bill: ${err.message}`, "error");
        }
    };

    // Function to manually release/clear a table
    const releaseTable = async (tableId, tableName) => {
        try {
            if (!tableId) {
                throw new Error("Table ID is required");
            }
            
            if (!sdk || !sdk.db) {
                throw new Error("SDK is not available");
            }
            
            // Show confirmation dialog
            if (!confirm(`Are you sure you want to release table ${tableName || tableId}? This will remove all order assignments.`)) {
                return;
            }
            
            try {
                // Log using try-catch to avoid console.error issues
                console.log(`[Dashboard] Releasing table ${tableId}`);
            } catch (logErr) {}
            
            // 1. Find all orders assigned to this table with KITCHEN status
            const ordersSnapshot = await sdk.db.collection("Orders")
                .where("tableId", "==", tableId)
                .where("currentStatus.label", "==", "KITCHEN")
                .get();
                
            if (ordersSnapshot.empty) {
                try {
                    // Log using try-catch to avoid console.error issues
                    console.log(`[Dashboard] No active orders found for table ${tableId}`);
                } catch (logErr) {}
                
                showToast(`Table ${tableName || tableId} released (no active orders found)`);
                
                // Force refresh kitchen orders listener to update UI
                if (kitchenOrdersUnsubscribe) {
                    kitchenOrdersUnsubscribe();
                }
                setupKitchenOrdersListener();
                return;
            }
            
            // 2. Update each order to remove table assignment without using batch
            let orderCount = 0;
            const updatePromises = [];
            
            ordersSnapshot.forEach(doc => {
                const orderRef = sdk.db.collection("Orders").doc(doc.id);
                // Add each update operation to our promises array
                updatePromises.push(
                    orderRef.update({
                        tableId: null,
                        // Don't change the status, just remove the table assignment
                    })
                );
                orderCount++;
            });
            
            // Wait for all updates to complete
            await Promise.all(updatePromises);
            
            try {
                // Log using try-catch to avoid console.error issues
                console.log(`[Dashboard] Released ${orderCount} orders from table ${tableId}`);
            } catch (logErr) {}
            
            showToast(`Table ${tableName || tableId} released successfully (${orderCount} orders)`);
            
            // 3. Force refresh kitchen orders listener to update UI
            if (kitchenOrdersUnsubscribe) {
                kitchenOrdersUnsubscribe();
            }
            setupKitchenOrdersListener();
            
        } catch (err) {
            // Use try-catch to avoid console.error issues
            try {
                const errorMsg = `[Dashboard] Error releasing table ${tableId}: ${err.message || 'Unknown error'}`;
                // Use alert instead of console.error
                setTimeout(() => {
                    console.log(errorMsg);
                }, 0);
            } catch (logErr) {}
            
            showToast(`Failed to release table: ${err.message || 'Unknown error'}`, "error");
        }
    };

    const filteredTables = useMemo(() => {
        return tables.filter(table => {
            if (table.type === 'dine_in') return true;
            if (table.type === 'qr' && table.orders.length > 0) return true;
            if (table.type === 'aggregator' && table.orders.length > 0) return true;
            return false;
        });
    }, [tables]);

    // Group dining tables by section
    const groupedDiningTables = useMemo(() => {
        return filteredTables.reduce((acc, table) => {
            if (table.type !== 'dine_in') return acc;
            if (!acc[table.section]) {
                acc[table.section] = [];
            }
            acc[table.section].push(table);
            return acc;
        }, {});
    }, [filteredTables]);

    // Format a number with commas
    const formatNumber = (num) => {
        return num.toLocaleString('en-IN');
    };

    // Format a currency value
    const formatCurrency = (amount) => {
        if (CurrencyData) {
            const currencyCode = UserSession?.getCurrencyCode() || "INR";
            return CurrencyData.formatAmount(amount, currencyCode);
        }
        // Fallback to default formatting if CurrencyData is not available
        const currencySymbol = UserSession?.getCurrency() || '₹';
        return `${currencySymbol} ${amount.toLocaleString('en-IN', {
            minimumFractionDigits: 0,
            maximumFractionDigits: 0
        })}`;
    };

    // Set up real-time listener for COMPLETED orders with date filtering
    const setupCompletedOrdersListener = () => {
        try {
            setLoadingCompletedOrders(true);
            setErrorCompletedOrders(null);

            // Check if SDK is available
            if (!sdk || !sdk.db.collection) {
                console.error("SDK is not available or not properly initialized");
                setErrorCompletedOrders("SDK is not available. Please try again later.");
                setLoadingCompletedOrders(false);
                return;
            }

            console.log("[COMPLETED Listener] Setting up real-time listener for COMPLETED orders");

            // Calculate date range based on selected filter
            const startDate = calculateStartDate(dateFilter, customDateRange.startDate);
            const endDate = calculateEndDate(dateFilter, customDateRange.endDate);

            // Query specifically for COMPLETED orders only
            let ordersQuery = sdk.db.collection("Orders")
                .where("currentStatus.label", "==", "COMPLETED")
                .orderBy("date", "desc")
                .limit(100);

            // Set up real-time listener
            const unsubscribe = ordersQuery.onSnapshot(
                (snapshot) => {
                    if (!snapshot || !snapshot.docs) {
                        setErrorCompletedOrders("Failed to fetch completed orders data");
                        setLoadingCompletedOrders(false);
                        return;
                    }

                    const fetchedOrders = snapshot.docs.map(doc => {
                        const data = doc.data();
                        return {
                            id: doc.id,
                            ...data,
                            // Ensure date is properly handled
                            date: parseDate(data.date)
                        };
                    });

                    // Client-side filtering for date range
                    const filteredOrders = fetchedOrders.filter(order => {
                        // Get order date
                        const orderDate = order.date;
                        if (!orderDate) return false;

                        // Check if within date range
                        return orderDate >= startDate && orderDate <= endDate;
                    });

                    // Store filtered completed orders
                    setOrders(filteredOrders);
                    setLoadingCompletedOrders(false);

                    console.log(`[Realtime update] Fetched ${fetchedOrders.length} COMPLETED orders, ${filteredOrders.length} matched the selected date range (real-time listener active)`);
                },
                (error) => {
                    console.error('Error in COMPLETED orders listener:', error);
                    setErrorCompletedOrders(`Failed to listen to completed orders updates: ${error.message}`);
                    setLoadingCompletedOrders(false);
                }
            );

            // Save the unsubscribe function
            setCompletedOrdersUnsubscribe(() => unsubscribe);
        } catch (err) {
            console.error('Error setting up completed orders listener:', err);
            setErrorCompletedOrders(`Failed to set up completed orders listener: ${err.message}`);
            setLoadingCompletedOrders(false);
        }
    };

    // Handle date range selection for custom filter
    const handleDateRangeSelect = (startDate, endDate) => {
        setCustomDateRange({ startDate, endDate });
        setDateFilter('custom');
    };

    // Handle scroll to load more items (restore this function)
    const handleScroll = (e) => {
        const { scrollTop, scrollHeight, clientHeight } = e.target;

        // Check if scrolled to bottom and not already loading
        if (scrollHeight - scrollTop <= clientHeight * 1.2 && !isLoadingMore && qrOrders.length >= loadedItemCount) {
            setIsLoadingMore(true);

            // Increase the limit and fetch more orders
            setLoadedItemCount(prev => prev + 50);

            // Reset loading state after a delay
            setTimeout(() => {
                setIsLoadingMore(false);
            }, 2000);
        }
    };

    // Handle access role management
    const handlePrintTemplateManagement = () => {
        if (!ModalManagerndow.sdk) {
            showToast("System components not loaded. Please try again later.");
            return;
        }

        // Ensure PrintTemplate is available
        if (!PrintTemplate) {
            console.error("PrintTemplate class is not available. Loading from PrintTemplate.js");
            showToast("Loading print template system...");

            // Try to load PrintTemplate.js dynamically if not already loaded
            const scriptElement = document.createElement('script');
            scriptElement.src = 'js/utils/PrintTemplate.js';
            scriptElement.onload = () => {
                console.log("PrintTemplate.js loaded successfully");
                // Retry after loading
                setTimeout(() => handlePrintTemplateManagement(), 500);
            };
            scriptElement.onerror = () => {
                console.error("Failed to load PrintTemplate.js");
                showToast("Failed to load print template system", "error");
            };
            document.head.appendChild(scriptElement);
            return;
        }

        // Create modal
        const modal = ModalManagerCenterModal({
            id: 'print-template-modal',
            title: "Receipt Template",
            content: `
                <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <!-- Left column: Template editor -->
                    <div class="space-y-6">
                        <div id="print-template-error-container" class="hidden p-3 bg-red-50 text-red-700 rounded-md"></div>

                        <div class="flex space-x-2 border-b">
                            <button id="bill-tab" class="px-4 py-2 bg-red-500 text-white focus:outline-none">BILL</button>
                            <button id="kot-tab" class="px-4 py-2 border border-gray-200 text-gray-700 focus:outline-none">KOT</button>
                        </div>

                        <div class="space-y-4">
                            <div class="flex justify-between items-center">
                                <h3 class="text-lg font-medium">Template Sections</h3>
                                <button id="add-section-btn" class="p-2 text-red-500 hover:bg-red-50 rounded-full">
                                    <i class="ph ph-plus"></i>
                                </button>
                            </div>
                            <div id="template-sections" class="space-y-4">
                                <!-- Template sections will be rendered here -->
                            </div>
                        </div>
                    </div>

                    <!-- Right column: Live preview -->
                    <div class="space-y-4">
                        <div class="flex justify-between items-center">
                            <h3 class="text-lg font-medium">Live Preview</h3>
                        </div>
                        
                        <div class="bg-gray-50 p-3 rounded-md text-sm text-gray-700 flex items-start">
                            <i class="ph ph-info mr-2 mt-0.5 text-gray-500"></i>
                            <p>Make changes to the template sections on the left, then click <strong>Refresh Preview</strong> to see how your receipt will look.</p>
                        </div>
                        
                        <div class="border-2 border-dashed border-gray-300 p-4 rounded-lg min-h-[500px] overflow-auto">
                            <div id="live-preview-container" class="text-sm">
                                <!-- Live preview content will be rendered here -->
                            </div>
                        </div>
                    </div>
                </div>
            `,
            actions: `
                <div class="flex justify-between p-4">
                    <button id="refresh-preview-btn" class="px-4 py-2 border rounded-md hover:bg-gray-50">
                        <i class="ph ph-arrows-clockwise mr-1"></i> Refresh Preview
                    </button>
                    <div class="space-x-3">
                        <button id="reset-template-btn" class="px-4 py-2 border text-red-500 rounded-md hover:bg-red-50">Reset</button>
                        <button id="save-template-btn" class="px-4 py-2 bg-red-500 text-white rounded-md hover:bg-red-600">Save</button>
                    </div>
                </div>
            `,
            size: '2xl',
            onShown: (modalControl) => {
                const billTab = document.getElementById('bill-tab');
                const kotTab = document.getElementById('kot-tab');
                const templateSections = document.getElementById('template-sections');
                const addSectionBtn = document.getElementById('add-section-btn');
                const refreshPreviewBtn = document.getElementById('refresh-preview-btn');
                const resetBtn = document.getElementById('reset-template-btn');
                const saveBtn = document.getElementById('save-template-btn');
                const errorContainer = document.getElementById('print-template-error-container');
                const livePreviewContainer = document.getElementById('live-preview-container');

                let currentTemplateType = 'bill';
                let templates = {};

                // Check if seller has saved templates
                if (seller && seller.printTemplate) {
                    console.log("Loading saved print templates from seller profile:", seller.printTemplate);
                    templates = seller.printTemplate;
                } else {
                    console.log("No saved templates found, using defaults from PrintTemplate.js");
                    // Use PrintTemplate.js to create default templates
                    if (PrintTemplate) {
                        try {
                            // Ensure seller data has necessary fields
                            const sellerData = {
                                businessName: seller?.businessName || 'Your Business',
                                logo: seller?.logo || '',
                                phone: seller?.phone || '',
                                address: seller?.address || '',
                                website: seller?.storeLink || seller?.website || '',
                                gstIN: seller?.gstIN || seller?.gstNo || ''
                            };

                            // Create default bill template
                            const defaultBill = new PrintTemplate({
                                type: 'bill',
                                orderData: {}, // Empty order for default template
                                seller: sellerData
                            });

                            // Create default KOT template
                            const defaultKOT = new PrintTemplate({
                                type: 'kot',
                                orderData: {}, // Empty order for default template
                                seller: sellerData
                            });

                            templates = {
                                'bill': defaultBill.templateData || getDefaultBillTemplate(),
                                'kot': defaultKOT.templateData || getDefaultKOTTemplate()
                            };
                        } catch (error) {
                            console.error("Error creating default templates from PrintTemplate.js:", error);
                            console.log("Falling back to built-in default templates");
                            templates = {
                                'bill': getDefaultBillTemplate(),
                                'kot': getDefaultKOTTemplate()
                            };
                        }
                    } else {
                        console.warn("PrintTemplate.js not available, using built-in default templates");
                        templates = {
                            'bill': getDefaultBillTemplate(),
                            'kot': getDefaultKOTTemplate()
                        };
                    }
                }

                // Ensure both bill and kot templates exist and have valid sections
                if (!templates.bill || !templates.bill.sections || templates.bill.sections.length === 0) {
                    console.log("Bill template missing or invalid, using default");
                    templates.bill = getDefaultBillTemplate();
                }

                if (!templates.kot || !templates.kot.sections || templates.kot.sections.length === 0) {
                    console.log("KOT template missing or invalid, using default");
                    templates.kot = getDefaultKOTTemplate();
                }

                // Generate live preview content based on the current template
                function updateLivePreview() {
                    console.log("updateLivePreview called - generating HTML for template type:", currentTemplateType);
                    livePreviewContainer.innerHTML = generatePreviewHTML(currentTemplateType);
                    console.log("Live preview updated");
                }

                // Generate HTML for the preview
                function generatePreviewHTML(templateType) {
                    console.log("generatePreviewHTML called with templateType:", templateType);

                    // Create a mock test order for the preview
                    const testOrder = {
                        id: 'PREVIEW-123',
                        billNo: 'PREVIEW-123',
                        date: new Date(),
                        tableId: 'Preview',
                        priceVariant: 'Dine-in',
                        items: [
                            { title: 'Butter Chicken', quantity: 2, price: 299.50 },
                            { title: 'Jeera Rice', quantity: 1, price: 149.00 }
                        ],
                        discount: 50,
                        charges: [
                            { name: 'Service Charge', value: 30 }
                        ],
                        total: 733.00,
                        payMode: 'CASH'
                    };

                    // Check if we have a custom template and it has sections
                    const currentTemplate = templates[templateType];
                    console.log("Current template:", currentTemplate);

                    if (currentTemplate && currentTemplate.sections && currentTemplate.sections.length > 0) {
                        // Use the PrintTemplate class directly to generate HTML based on the current template
                        if (PrintTemplate) {
                            try {
                                console.log("Using PrintTemplate for preview with seller data:", seller);

                                // Ensure seller data has necessary fields
                                const sellerData = {
                                    businessName: seller?.businessName || 'Your Business',
                                    logo: seller?.logo || '',
                                    phone: seller?.phone || '',
                                    address: seller?.address || '',
                                    website: seller?.storeLink || seller?.website || '',
                                    gstIN: seller?.gstIN || seller?.gstNo || ''
                                };

                                // Create a PrintTemplate instance and generate HTML
                                const template = new PrintTemplate({
                                    orderData: testOrder,
                                    seller: sellerData,
                                    type: templateType,
                                    templateData: currentTemplate
                                });

                                const html = template.toHTML();
                                console.log("Generated HTML preview successfully");
                                return html;
                            } catch (error) {
                                console.error('Error generating template preview:', error);
                                return `<div class="text-center text-red-500 p-4">
                                    <i class="ph ph-warning-circle text-3xl mb-2"></i>
                                    <p>Error generating preview: ${error.message}</p>
                                    <pre class="mt-2 text-xs text-left bg-gray-100 p-2 rounded overflow-auto">${error.stack}</pre>
                                </div>`;
                            }
                        } else {
                            console.warn("PrintTemplate is not available");
                            return `<div class="text-center text-amber-500 p-4">
                                <i class="ph ph-warning-circle text-3xl mb-2"></i>
                                <p>PrintTemplate class is not available. Please refresh the page and try again.</p>
                            </div>`;
                        }
                    }

                    // Fallback to default preview if no template or PrintTemplate not available
                    return `
                        <div class="text-center">
                            <div class="w-20 h-20 mx-auto bg-red-100 rounded-full flex items-center justify-center mb-2">
                                <i class="ph ph-storefront text-red-500 text-2xl"></i>
                            </div>
                            <h2 class="text-xl font-bold">${seller?.businessName || 'Your Business Name'}</h2>
                        </div>
                        <div class="text-center text-sm text-gray-600 mt-2">
                            <p>Phone: ${seller?.phone || '1234567890'}</p>
                            <p>Address: ${seller?.address || '123 Main St'}</p>
                            <p>Web: ${seller?.storeLink || 'www.yourbusiness.com'}</p>
                            <p>GST: ${seller?.gstIN || 'GSTIN12345'}</p>
                        </div>
                        <div class="mt-4">
                            <p>Bill No: #12345</p>
                            <p>Order from: Dine-in</p>
                        </div>
                        <div class="mt-4 border-t border-b py-2">
                            <table class="w-full">
                                <thead>
                                    <tr class="text-left">
                                        <th class="py-1 px-2">Qt</th>
                                        <th class="py-1">Item</th>
                                        <th class="py-1 text-right">Price</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr>
                                        <td class="py-1 px-2">2</td>
                                        <td class="py-1">Butter Chicken</td>
                                        <td class="py-1 text-right">${UserSession?.getCurrency()}599</td>
                                    </tr>
                                    <tr>
                                        <td class="py-1 px-2">1</td>
                                        <td class="py-1">Jeera Rice</td>
                                        <td class="py-1 text-right">${UserSession?.getCurrency()}149</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                        <div class="mt-4 text-right">
                            <p>Sub Total: ${UserSession?.getCurrency()}748</p>
                            <p>Discount: -${UserSession?.getCurrency()}50</p>
                            <p>GST: ${UserSession?.getCurrency()}35</p>
                            <p class="font-bold mt-2">TOTAL: ${UserSession?.getCurrency()}733</p>
                        </div>
                        <div class="mt-4 text-right">
                            <p>Payment mode: Cash</p>
                        </div>
                        ${templateType === 'bill' ? `
                            <div class="mt-4 flex justify-center">
                                <div class="w-32 h-32 bg-gray-200 flex items-center justify-center">
                                    <i class="ph ph-qr-code text-4xl"></i>
                                </div>
                            </div>
                        ` : ''}
                        <div class="mt-4 text-center text-sm">
                            <p>Thank you!</p>
                            <p>${new Date().toLocaleString()}</p>
                        </div>
                    `;
                }

                // Render template sections
                function renderTemplateSections() {
                    console.log("Starting renderTemplateSections for type:", currentTemplateType);
                    templateSections.innerHTML = '';

                    const currentTemplate = templates[currentTemplateType];
                    if (!currentTemplate || !currentTemplate.sections) {
                        console.error("No template or sections found for type:", currentTemplateType);
                        return;
                    }

                    console.log("Rendering sections:", currentTemplate.sections);

                    currentTemplate.sections.forEach((section, index) => {
                        console.log("Rendering section", index, ":", section);

                        const sectionCard = document.createElement('div');
                        sectionCard.className = 'border rounded-lg p-4 bg-white shadow-sm mb-4';
                        sectionCard.dataset.index = index;

                        // Format toolbar
                        const toolbar = document.createElement('div');
                        toolbar.className = 'flex justify-between items-center mb-3';

                        const formatControls = document.createElement('div');
                        formatControls.className = 'flex items-center space-x-2';

                        // Font size selector
                        const fontSizeSelect = document.createElement('select');
                        fontSizeSelect.className = 'px-2 py-1 border rounded text-sm focus:outline-none focus:ring-2 focus:ring-red-500';
                        fontSizeSelect.innerHTML = `
                            <option value="20" ${section.fontSize === 20 ? 'selected' : ''}>Size 20</option>
                            <option value="22" ${section.fontSize === 22 ? 'selected' : ''}>Size 22</option>
                            <option value="24" ${section.fontSize === 24 ? 'selected' : ''}>Size 24</option>
                            <option value="26" ${section.fontSize === 26 ? 'selected' : ''}>Size 26</option>
                            <option value="28" ${section.fontSize === 28 ? 'selected' : ''}>Size 28</option>
                            <option value="30" ${section.fontSize === 30 ? 'selected' : ''}>Size 30</option>
                        `;

                        // Alignment selector
                        const alignmentSelect = document.createElement('select');
                        alignmentSelect.className = 'px-2 py-1 border rounded text-sm focus:outline-none focus:ring-2 focus:ring-red-500';
                        alignmentSelect.innerHTML = `
                            <option value="TextAlign.left" ${section.alignment === 'TextAlign.left' ? 'selected' : ''}>Left</option>
                            <option value="TextAlign.center" ${section.alignment === 'TextAlign.center' ? 'selected' : ''}>Center</option>
                            <option value="TextAlign.right" ${section.alignment === 'TextAlign.right' ? 'selected' : ''}>Right</option>
                        `;

                        // Style buttons container
                        const styleBtns = document.createElement('div');
                        styleBtns.className = 'flex items-center space-x-1';

                        // Bold button
                        const boldBtn = document.createElement('button');
                        boldBtn.className = `p-1.5 rounded ${section.isBold ? 'bg-red-100 text-red-500' : 'text-gray-500 hover:bg-gray-100'}`;
                        boldBtn.innerHTML = '<i class="ph ph-text-b"></i>';
                        boldBtn.title = 'Bold';

                        // Underline button
                        const underlineBtn = document.createElement('button');
                        underlineBtn.className = `p-1.5 rounded ${section.isUnderlined ? 'bg-red-100 text-red-500' : 'text-gray-500 hover:bg-gray-100'}`;
                        underlineBtn.innerHTML = '<i class="ph ph-text-underline"></i>';
                        underlineBtn.title = 'Underline';

                        // Delete button
                        const deleteBtn = document.createElement('button');
                        deleteBtn.className = 'p-1.5 rounded text-gray-400 hover:text-red-500 hover:bg-red-50';
                        deleteBtn.innerHTML = '<i class="ph ph-trash"></i>';
                        deleteBtn.title = 'Delete Section';

                        // Add event listeners
                        fontSizeSelect.addEventListener('change', () => {
                            templates[currentTemplateType].sections[index].fontSize = parseInt(fontSizeSelect.value);
                            updateLivePreview();
                        });

                        alignmentSelect.addEventListener('change', () => {
                            templates[currentTemplateType].sections[index].alignment = alignmentSelect.value;
                            const textArea = sectionCard.querySelector('textarea');
                            if (textArea) {
                                textArea.className = textArea.className.replace(/text-(left|center|right)/,
                                    alignmentSelect.value === 'TextAlign.center' ? 'text-center' :
                                        alignmentSelect.value === 'TextAlign.right' ? 'text-right' :
                                            'text-left'
                                );
                            }
                            updateLivePreview();
                        });

                        boldBtn.addEventListener('click', () => {
                            templates[currentTemplateType].sections[index].isBold = !templates[currentTemplateType].sections[index].isBold;
                            boldBtn.classList.toggle('bg-red-100');
                            boldBtn.classList.toggle('text-red-500');
                            const textArea = sectionCard.querySelector('textarea');
                            if (textArea) {
                                textArea.classList.toggle('font-bold');
                            }
                            updateLivePreview();
                        });

                        underlineBtn.addEventListener('click', () => {
                            templates[currentTemplateType].sections[index].isUnderlined = !templates[currentTemplateType].sections[index].isUnderlined;
                            underlineBtn.classList.toggle('bg-red-100');
                            underlineBtn.classList.toggle('text-red-500');
                            const textArea = sectionCard.querySelector('textarea');
                            if (textArea) {
                                textArea.classList.toggle('underline');
                            }
                            updateLivePreview();
                        });

                        deleteBtn.addEventListener('click', () => {
                            if (templates[currentTemplateType].sections.length <= 1) {
                                errorContainer.textContent = 'Cannot delete the last section. You need at least one section.';
                                errorContainer.classList.remove('hidden');
                                return;
                            }

                            if (confirm('Are you sure you want to delete this section?')) {
                                templates[currentTemplateType].sections.splice(index, 1);
                                renderTemplateSections();
                                updateLivePreview();
                            }
                        });

                        // Assemble toolbar
                        formatControls.appendChild(fontSizeSelect);
                        formatControls.appendChild(alignmentSelect);
                        styleBtns.appendChild(boldBtn);
                        styleBtns.appendChild(underlineBtn);
                        formatControls.appendChild(styleBtns);
                        toolbar.appendChild(formatControls);
                        toolbar.appendChild(deleteBtn);
                        sectionCard.appendChild(toolbar);

                        // Create textarea container
                        const textAreaContainer = document.createElement('div');
                        textAreaContainer.className = 'relative';

                        // Get text alignment class
                        let alignmentClass = 'text-left';
                        if (section.alignment === 'TextAlign.center') alignmentClass = 'text-center';
                        if (section.alignment === 'TextAlign.right') alignmentClass = 'text-right';

                        // Create textarea
                        const textArea = document.createElement('textarea');
                        textArea.className = `w-full min-h-24 p-3 border rounded-lg transition-all ${alignmentClass} ${section.isBold ? 'font-bold' : ''} ${section.isUnderlined ? 'underline' : ''} focus:outline-none focus:ring-2 focus:ring-red-500 text-sm`;
                        textArea.value = section.template || '';
                        textArea.placeholder = 'Enter template content here... Use # to insert variables';

                        // Add input event listener
                        textArea.addEventListener('input', () => {
                            const sectionIndex = parseInt(textArea.closest('[data-index]').dataset.index);
                            templates[currentTemplateType].sections[sectionIndex].template = textArea.value;
                            updateLivePreview();
                        });

                        // Create insert variable button
                        const insertVariableBtn = document.createElement('button');
                        insertVariableBtn.className = 'absolute right-2 top-2 p-1.5 rounded text-gray-500 hover:text-red-500 hover:bg-red-50';
                        insertVariableBtn.innerHTML = '<i class="ph ph-brackets-curly"></i>';
                        insertVariableBtn.title = 'Insert Variable';
                        insertVariableBtn.addEventListener('click', () => {
                            showVariablesList(textArea);
                        });

                        // Assemble textarea container
                        textAreaContainer.appendChild(textArea);
                        textAreaContainer.appendChild(insertVariableBtn);
                        sectionCard.appendChild(textAreaContainer);

                        // Add section to template
                        templateSections.appendChild(sectionCard);
                    });

                    console.log("Finished rendering sections");
                }

                // Show variables list for insertion
                function showVariablesList(textArea) {
                    // Create dropdown for variables if it doesn't exist
                    let variablesDropdown = document.getElementById('variables-dropdown');
                    if (!variablesDropdown) {
                        variablesDropdown = document.createElement('div');
                        variablesDropdown.id = 'variables-dropdown';
                        variablesDropdown.className = 'absolute z-10 bg-white border rounded-md shadow-lg p-2 max-h-60 overflow-y-auto';
                        variablesDropdown.style.width = '250px';
                        variablesDropdown.style.display = 'none';
                        document.body.appendChild(variablesDropdown);
                    }

                    // Populate dropdown with variables
                    variablesDropdown.innerHTML = `
                        <div class="text-sm font-medium text-gray-700 mb-2">Insert Variable</div>
                        <div class="space-y-1">
                            ${[
                            { name: 'businessName', label: 'Business Name' },
                            { name: 'logo', label: 'Business Logo' },
                            { name: 'phone', label: 'Phone Number' },
                            { name: 'address', label: 'Address' },
                            { name: 'storeLink', label: 'Store Website' },
                            { name: 'gstIN', label: 'GST Number' },
                            { name: 'billNo', label: 'Bill Number' },
                            { name: 'orderSource', label: 'Order Source' },
                            { name: 'payMode', label: 'Payment Mode' },
                            { name: 'timestamp', label: 'Date & Time' },
                            { name: 'cut', label: 'Divider Line' },
                            { name: 'upiQR', label: 'UPI QR Code' },
                            { name: 'itemsList', label: 'Items List (Bill)' },
                            { name: 'kotItemsList', label: 'Items List (KOT)' },
                            { name: 'subtotal', label: 'Subtotal' },
                            { name: 'discount', label: 'Discount' },
                            { name: 'charges', label: 'Additional Charges' },
                            { name: 'total', label: 'Total Amount' },
                            { name: 'instructions', label: 'Special Instructions' }
                        ].map(variable => `
                                <div class="variable-item p-1 hover:bg-gray-100 rounded cursor-pointer" data-variable="${variable.name}">
                                    <span class="text-red-500">#${variable.name}</span> - ${variable.label}
                                </div>
                            `).join('')}
                        </div>
                    `;

                    // Position dropdown near text area
                    const textAreaRect = textArea.getBoundingClientRect();
                    variablesDropdown.style.top = `${textAreaRect.bottom + window.scrollY}px`;
                    variablesDropdown.style.left = `${textAreaRect.left + window.scrollX}px`;
                    variablesDropdown.style.display = 'block';

                    // Handle variable click
                    const variableItems = variablesDropdown.querySelectorAll('.variable-item');
                    variableItems.forEach(item => {
                        item.addEventListener('click', () => {
                            const variable = item.dataset.variable;
                            const currentPos = textArea.selectionStart;
                            const text = textArea.value;
                            const newText = text.substring(0, currentPos) + `#${variable}` + text.substring(currentPos);
                            textArea.value = newText;

                            // Update the section content
                            const sectionIndex = parseInt(textArea.closest('[data-index]').dataset.index);
                            templates[currentTemplateType].sections[sectionIndex].template = newText;

                            // Update the live preview
                            updateLivePreview();

                            // Close the dropdown
                            variablesDropdown.style.display = 'none';
                        });
                    });

                    // Close dropdown when clicking elsewhere
                    const handleClickOutside = (e) => {
                        if (!variablesDropdown.contains(e.target) && e.target !== textArea) {
                            variablesDropdown.style.display = 'none';
                            document.removeEventListener('click', handleClickOutside);
                        }
                    };

                    // Delay adding the event listener to prevent immediate closure
                    setTimeout(() => {
                        document.addEventListener('click', handleClickOutside);
                    }, 10);
                }

                // Add new section
                function addNewSection() {
                    templates[currentTemplateType].sections.push({
                        content: '',
                        fontSize: 24,
                        alignment: 'TextAlign.left',
                        isBold: false,
                        isUnderlined: false
                    });
                    renderTemplateSections();
                    updateLivePreview();
                }

                // Reset to default
                function resetToDefault() {
                    if (confirm('Are you sure you want to reset to default template? All changes will be lost.')) {
                        templates[currentTemplateType] = currentTemplateType === 'bill' ?
                            getDefaultBillTemplate() : getDefaultKOTTemplate();
                        renderTemplateSections();
                        updateLivePreview();
                    }
                }

                // Save template
                async function saveTemplate() {
                    try {
                        console.log("Saving templates to profile:", templates);
                        await sdk.profile.update({
                            printTemplate: templates
                        });
                        ModalManagerast('Print template saved successfully');
                        modalControl.close();
                    } catch (error) {
                        console.error('Error saving print template:', error);
                        errorContainer.textContent = 'Failed to save template. Please try again.';
                        errorContainer.classList.remove('hidden');
                    }
                }

                // Initialize the modal
                billTab.addEventListener('click', () => {
                    currentTemplateType = 'bill';
                    billTab.classList.add('bg-red-500', 'text-white');
                    billTab.classList.remove('border', 'border-gray-200', 'text-gray-700');
                    kotTab.classList.remove('bg-red-500', 'text-white');
                    kotTab.classList.add('border', 'border-gray-200', 'text-gray-700');
                    renderTemplateSections();
                    updateLivePreview();
                });

                kotTab.addEventListener('click', () => {
                    currentTemplateType = 'kot';
                    kotTab.classList.add('bg-red-500', 'text-white');
                    kotTab.classList.remove('border', 'border-gray-200', 'text-gray-700');
                    billTab.classList.remove('bg-red-500', 'text-white');
                    billTab.classList.add('border', 'border-gray-200', 'text-gray-700');
                    renderTemplateSections();
                    updateLivePreview();
                });

                addSectionBtn.addEventListener('click', addNewSection);
                refreshPreviewBtn.addEventListener('click', updateLivePreview);
                resetBtn.addEventListener('click', resetToDefault);
                saveBtn.addEventListener('click', saveTemplate);

                // Add this right after templates initialization in onShown
                // Debug logging for template initialization
                console.log('Template initialization:', {
                    seller,
                    hasTemplates: !!seller?.printTemplate,
                    loadedTemplates: templates,
                    currentType: currentTemplateType,
                    currentTemplate: templates[currentTemplateType],
                    hasSections: templates[currentTemplateType]?.sections?.length > 0
                });

                // Ensure we have valid templates
                if (!templates[currentTemplateType]?.sections?.length) {
                    console.log('No valid template found, creating default');
                    templates[currentTemplateType] = currentTemplateType === 'bill' ? getDefaultBillTemplate() : getDefaultKOTTemplate();
                }

                // Initial render
                console.log('Starting initial render with template:', templates[currentTemplateType]);
                renderTemplateSections();
                updateLivePreview();
            }
        });
    };

    // Handle bulk tax update management
    // ... existing code ...

    // Handle bulk tax update
    const handleBulkTaxUpdate = () => {
        if (!ModalManager || !sdk) {
            showToast("System components not loaded. Please try again later.");
            return;
        }

        // Create modal
        const modal = ModalManager.createCenterModal({
            id: 'bulk-tax-update-modal',
            title: "Bulk Tax Update",
            content: `
                <div class="p-4">
                    <div id="tax-update-error-container" class="mb-4 hidden p-3 bg-red-50 text-red-700 rounded-md"></div>
                    
                    <div class="mb-4">
                        <p class="text-sm text-gray-600 mb-4">
                            Update tax rates for all products at once. You can choose to apply taxes as:
                        </p>
                        <ul class="list-disc pl-5 text-sm text-gray-600 mb-4">
                            <li><strong>Exclusive:</strong> Tax will be added to the listed price</li>
                            <li><strong>Inclusive:</strong> Price already includes this tax</li>
                            <li><strong>Both:</strong> Apply both inclusive and exclusive taxes with different rates</li>
                        </ul>
                    </div>
                    
                    <div class="mb-6">
                        <div class="bg-amber-50 border border-amber-200 rounded-md p-3 mb-4">
                            <div class="flex items-start">
                                <i class="ph ph-warning-circle text-amber-500 mt-0.5 mr-2 text-lg"></i>
                                <p class="text-sm text-amber-700">
                                    This action will update tax settings for <strong>all products</strong> in your inventory.
                                    <br/><br/>
                                    When updating taxes, existing taxes of the <strong>same type</strong> (inclusive or exclusive) will be replaced, 
                                    but taxes of the <strong>other type</strong> will be preserved. This allows you to maintain both inclusive and 
                                    exclusive taxes on products.
                                    <br/><br/>
                                    Use the <strong>Reset to Default</strong> button to set all taxes to zero, effectively removing all tax configurations
                                    from your products.
                                </p>
                            </div>
                        </div>
                        
                        <div class="mb-4">
                            <label class="flex items-center cursor-pointer">
                                <input type="checkbox" id="respect-existing-config" class="form-checkbox h-5 w-5 text-red-500 rounded" />
                                <span class="ml-2 text-sm text-gray-700">Don't update products with existing tax configurations</span>
                            </label>
                        </div>
                        
                        <div id="tax-config-container" class="space-y-4">
                            <!-- Tax items will be added here -->
                        </div>
                        
                        <div class="mt-4 flex justify-between">
                            <button id="add-tax-btn" class="flex items-center text-sm text-blue-600 hover:text-blue-800">
                                <i class="ph ph-plus-circle mr-1"></i>
                                Add Another Tax
                            </button>
                            <button id="reset-to-default-btn" class="flex items-center text-sm text-red-600 hover:text-red-800">
                                <i class="ph ph-trash mr-1"></i>
                                Reset to Default (Zero Tax)
                            </button>
                        </div>
                    </div>
                </div>
            `,
            actions: `
                <div class="flex justify-end p-4 space-x-3">
                    <button id="cancel-tax-update-btn" class="px-4 py-2 border rounded-md hover:bg-gray-50">Cancel</button>
                    <button id="save-tax-update-btn" class="px-4 py-2 bg-red-500 text-white rounded-md hover:bg-red-600">Update All Products</button>
                </div>
            `,
            size: 'md',
            onShown: (modalControl) => {
                const taxConfigContainer = document.getElementById('tax-config-container');
                const addTaxBtn = document.getElementById('add-tax-btn');
                const errorContainer = document.getElementById('tax-update-error-container');
                const cancelButton = document.getElementById('cancel-tax-update-btn');
                const saveButton = document.getElementById('save-tax-update-btn');
                const respectExistingConfig = document.getElementById('respect-existing-config');

                // Keep track of tax items
                let taxItems = [];

                // Function to create a new tax item
                const createTaxItem = (data = {}) => {
                    const id = Date.now().toString();
                    const taxItem = {
                        id,
                        name: data.name || '',
                        exclusiveValue: data.exclusiveValue || '',
                        inclusiveValue: data.inclusiveValue || '',
                        type: data.type || 'percentage',
                        mode: data.mode || 'both' // 'exclusive', 'inclusive', or 'both'
                    };

                    taxItems.push(taxItem);
                    return taxItem;
                };

                // Function to render a tax item
                const renderTaxItem = (taxItem) => {
                    const taxItemEl = document.createElement('div');
                    taxItemEl.className = 'tax-item border rounded-md p-3';
                    taxItemEl.dataset.id = taxItem.id;

                    taxItemEl.innerHTML = `
                        <div class="flex items-center justify-between mb-2">
                            <div class="font-medium">Tax Configuration</div>
                            <button class="remove-tax-btn text-gray-400 hover:text-red-500 ${taxItems.length <= 1 ? 'hidden' : ''}">
                                <i class="ph ph-trash"></i>
                            </button>
                        </div>
                        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
                            <div>
                                <label class="block text-sm text-gray-600 mb-1">Tax Name</label>
                                <input 
                                    type="text" 
                                    class="tax-name-input w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-red-500" 
                                    placeholder="e.g. GST" 
                                    value="${taxItem.name}"
                                />
                            </div>
                            <div>
                                <label class="block text-sm text-gray-600 mb-1">Type</label>
                                <select 
                                    class="tax-type-input w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
                                >
                                    <option value="percentage" ${taxItem.type === 'percentage' ? 'selected' : ''}>Percentage (%)</option>
                                    <option value="fixed" ${taxItem.type === 'fixed' ? 'selected' : ''}>Fixed Amount (${UserSession?.getCurrency()})</option>
                                </select>
                            </div>
                        </div>
                        <div class="mb-3">
                            <label class="block text-sm text-gray-600 mb-1">Apply As</label>
                            <div class="flex gap-4 mt-1">
                                <label class="flex items-center cursor-pointer">
                                    <input type="radio" name="mode-${taxItem.id}" class="tax-mode-input" value="exclusive" ${taxItem.mode === 'exclusive' ? 'checked' : ''} />
                                    <span class="ml-1 text-sm">Exclusive</span>
                                </label>
                                <label class="flex items-center cursor-pointer">
                                    <input type="radio" name="mode-${taxItem.id}" class="tax-mode-input" value="inclusive" ${taxItem.mode === 'inclusive' ? 'checked' : ''} />
                                    <span class="ml-1 text-sm">Inclusive</span>
                                </label>
                                <label class="flex items-center cursor-pointer">
                                    <input type="radio" name="mode-${taxItem.id}" class="tax-mode-input" value="both" ${taxItem.mode === 'both' ? 'checked' : ''} />
                                    <span class="ml-1 text-sm">Both</span>
                                </label>
                            </div>
                        </div>
                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                            <div>
                                <label class="block text-sm text-gray-600 mb-1">Exclusive Tax Value</label>
                                <input 
                                    type="number" 
                                    class="tax-exclusive-value-input w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-red-500" 
                                    placeholder="e.g. 18" 
                                    min="0" 
                                    max="100" 
                                    value="${taxItem.exclusiveValue}"
                                />
                            </div>
                            <div>
                                <label class="block text-sm text-gray-600 mb-1">Inclusive Tax Value</label>
                                <input 
                                    type="number" 
                                    class="tax-inclusive-value-input w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-red-500" 
                                    placeholder="e.g. 5" 
                                    min="0" 
                                    max="100" 
                                    value="${taxItem.inclusiveValue}"
                                />
                            </div>
                        </div>
                    `;

                    // Add event listener for remove button
                    const removeBtn = taxItemEl.querySelector('.remove-tax-btn');
                    if (removeBtn) {
                        removeBtn.addEventListener('click', () => {
                            taxItems = taxItems.filter(item => item.id !== taxItem.id);
                            taxItemEl.remove();

                            // Show/hide remove buttons based on number of tax items
                            if (taxItems.length <= 1) {
                                document.querySelectorAll('.remove-tax-btn').forEach(btn => {
                                    btn.classList.add('hidden');
                                });
                            }
                        });
                    }

                    // Add event listeners to update tax item data
                    const nameInput = taxItemEl.querySelector('.tax-name-input');
                    const typeInput = taxItemEl.querySelector('.tax-type-input');
                    const exclusiveValueInput = taxItemEl.querySelector('.tax-exclusive-value-input');
                    const inclusiveValueInput = taxItemEl.querySelector('.tax-inclusive-value-input');
                    const modeInputs = taxItemEl.querySelectorAll('.tax-mode-input');

                    nameInput.addEventListener('input', () => {
                        const index = taxItems.findIndex(item => item.id === taxItem.id);
                        if (index !== -1) {
                            taxItems[index].name = nameInput.value;
                        }
                    });

                    typeInput.addEventListener('change', () => {
                        const index = taxItems.findIndex(item => item.id === taxItem.id);
                        if (index !== -1) {
                            taxItems[index].type = typeInput.value;
                        }
                    });

                    exclusiveValueInput.addEventListener('input', () => {
                        const index = taxItems.findIndex(item => item.id === taxItem.id);
                        if (index !== -1) {
                            taxItems[index].exclusiveValue = exclusiveValueInput.value;
                        }
                    });

                    inclusiveValueInput.addEventListener('input', () => {
                        const index = taxItems.findIndex(item => item.id === taxItem.id);
                        if (index !== -1) {
                            taxItems[index].inclusiveValue = inclusiveValueInput.value;
                        }
                    });

                    modeInputs.forEach(input => {
                        input.addEventListener('change', () => {
                            const index = taxItems.findIndex(item => item.id === taxItem.id);
                            if (index !== -1) {
                                taxItems[index].mode = input.value;
                        }
                        });
                    });

                    return taxItemEl;
                };

                // Function to add a new tax item
                const addTaxItem = (data = {}) => {
                    const taxItem = createTaxItem(data);
                    const taxItemEl = renderTaxItem(taxItem);
                    taxConfigContainer.appendChild(taxItemEl);

                    // Show remove buttons if there are multiple tax items
                    if (taxItems.length > 1) {
                        document.querySelectorAll('.remove-tax-btn').forEach(btn => {
                            btn.classList.remove('hidden');
                        });
                    }
                };

                // Add default tax item
                addTaxItem({ name: 'GST', exclusiveValue: '18', inclusiveValue: '', type: 'percentage', mode: 'exclusive' });

                // Add event listener for add tax button
                addTaxBtn.addEventListener('click', () => {
                    addTaxItem();
                });
                
                // Add event listener for reset to default button
                const resetToDefaultBtn = document.getElementById('reset-to-default-btn');
                resetToDefaultBtn.addEventListener('click', () => {
                    // Confirm before resetting
                    if (confirm('Are you sure you want to reset all taxes to zero? This will remove all tax configurations from products when applied.')) {
                        // Clear existing tax items
                        taxItems = [];
                        taxConfigContainer.innerHTML = '';
                        
                        // Add a single zero tax item
                        addTaxItem({ 
                            name: 'No Tax', 
                            exclusiveValue: '0', 
                            inclusiveValue: '0', 
                            type: 'percentage', 
                            mode: 'both' 
                        });
                    }
                });

                // Validation function
                const validateForm = () => {
                    // Reset error
                    errorContainer.classList.add('hidden');
                    errorContainer.textContent = '';

                    // Check if there are any tax items
                    if (taxItems.length === 0) {
                        errorContainer.textContent = 'Please add at least one tax configuration';
                        errorContainer.classList.remove('hidden');
                        return false;
                    }

                    // Validate each tax item
                    for (let i = 0; i < taxItems.length; i++) {
                        const taxItem = taxItems[i];
                        if (!taxItem.name.trim()) {
                            errorContainer.textContent = `Tax name is required for item #${i + 1}`;
                            errorContainer.classList.remove('hidden');
                            return false;
                        }
                        
                        // Check both values regardless of mode
                        if (taxItem.mode === 'exclusive' || taxItem.mode === 'both') {
                            const exclusiveValue = parseFloat(taxItem.exclusiveValue);
                            if (isNaN(exclusiveValue) || exclusiveValue < 0) {
                                errorContainer.textContent = `Please enter a valid exclusive tax value for ${taxItem.name}`;
                                errorContainer.classList.remove('hidden');
                                return false;
                            }
                            if (taxItem.type === 'percentage' && exclusiveValue > 100) {
                                errorContainer.textContent = `Exclusive percentage value cannot exceed 100% for ${taxItem.name}`;
                                errorContainer.classList.remove('hidden');
                                return false;
                            }
                        }
                        
                        if (taxItem.mode === 'inclusive' || taxItem.mode === 'both') {
                            const inclusiveValue = parseFloat(taxItem.inclusiveValue);
                            if (isNaN(inclusiveValue) || inclusiveValue < 0) {
                                errorContainer.textContent = `Please enter a valid inclusive tax value for ${taxItem.name}`;
                                errorContainer.classList.remove('hidden');
                                return false;
                            }
                            if (taxItem.type === 'percentage' && inclusiveValue > 100) {
                                errorContainer.textContent = `Inclusive percentage value cannot exceed 100% for ${taxItem.name}`;
                                errorContainer.classList.remove('hidden');
                                return false;
                            }
                        }
                    }
                    return true;
                };

                // Event handlers
                cancelButton.addEventListener('click', () => {
                    modalControl.close();
                });

                saveButton.addEventListener('click', async () => {
                    if (!validateForm()) return;
                    try {
                        saveButton.disabled = true;
                        saveButton.innerHTML = `
                            <svg class="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            Updating...`;
                        const taxCharges = [];
                        
                        // Process each tax item
                        taxItems.forEach(item => {
                            // Handle "both" mode by creating two separate tax entries
                            if (item.mode === 'both') {
                                // Create exclusive tax
                                if (item.exclusiveValue && parseFloat(item.exclusiveValue) > 0) {
                                    taxCharges.push({
                                        name: item.name.trim(),
                                        value: item.type === 'percentage' ? `${parseFloat(item.exclusiveValue)}%` : parseFloat(item.exclusiveValue),
                                        type: item.type,
                                        inclusive: false,
                                        mode: 'exclusive'
                                    });
                                }
                                
                                // Create inclusive tax
                                if (item.inclusiveValue && parseFloat(item.inclusiveValue) > 0) {
                                    taxCharges.push({
                                        name: `Inc. ${item.name.trim()}`,
                                        value: item.type === 'percentage' ? `${parseFloat(item.inclusiveValue)}%` : parseFloat(item.inclusiveValue),
                                        type: item.type,
                                        inclusive: true,
                                        mode: 'inclusive'
                                    });
                                }
                            } else {
                                // Handle single mode (exclusive or inclusive)
                                let value = item.mode === 'exclusive' ? item.exclusiveValue : item.inclusiveValue;
                                // For inclusive taxes, prefix the name with "Inc." to make it clear
                                const taxName = item.mode === 'inclusive' ? `Inc. ${item.name.trim()}` : item.name.trim();
                                
                                taxCharges.push({
                                    name: taxName,
                                    value: item.type === 'percentage' ? `${parseFloat(value)}%` : parseFloat(value),
                                    type: item.type,
                                    inclusive: item.mode === 'inclusive',
                                    mode: item.mode
                                });
                            }
                        });
                        const updateTimestamp = new Date().toISOString();
                        const updateHashtag = `#BulkTaxUpdate_${Math.floor(Date.now() / 1000)}`;
                        const productsSnapshot = await sdk.db.collection("Product").get();
                        let successCount = 0;
                        const respectExisting = respectExistingConfig.checked;
                        const batch = sdk.db.firestore.batch();
                        productsSnapshot.forEach(doc => {
                            const productData = doc.data();
                            const hasExistingTaxConfig = productData.charges && Array.isArray(productData.charges) && productData.charges.length > 0;
                            
                            // Instead of replacing all charges, we'll update only the ones matching the selected mode
                            let updatedCharges = [];
                            
                            if (hasExistingTaxConfig && !respectExisting) {
                                // Keep existing charges of the opposite mode
                                const existingCharges = productData.charges || [];
                                
                                // Get the mode we're updating (inclusive or exclusive)
                                const updatingModes = new Set(taxCharges.map(charge => charge.inclusive ? 'inclusive' : 'exclusive'));
                                
                                // Filter existing charges to keep those with different modes than what we're updating
                                const chargesToKeep = existingCharges.filter(charge => {
                                    const chargeMode = charge.inclusive ? 'inclusive' : 'exclusive';
                                    return !updatingModes.has(chargeMode);
                                });
                                
                                // Combine existing charges (of different modes) with new tax charges
                                updatedCharges = [...chargesToKeep, ...taxCharges];
                            } else if (respectExisting && hasExistingTaxConfig) {
                                // Skip this product if we're respecting existing configs
                                return;
                            } else {
                                // No existing charges or not respecting existing, use new charges
                                updatedCharges = taxCharges;
                            }
                            
                            productData.charges = updatedCharges;
                            productData.taxUpdateInfo = {
                                timestamp: updateTimestamp,
                                hashtag: updateHashtag,
                                isFromBulkUpdate: true
                            };
                            batch.update(doc.ref, {
                                charges: productData.charges,
                                taxUpdateInfo: productData.taxUpdateInfo
                            });
                            successCount++;
                        });
                        if (seller && seller.id) {
                            const sellerRef = sdk.profile;
                            batch.update(sellerRef, {
                                lastBulkTaxUpdate: {
                                    timestamp: updateTimestamp,
                                    hashtag: updateHashtag,
                                    taxes: taxCharges,
                                    respectExistingConfig: respectExisting
                                }
                            });
                        }
                        await batch.commit();
                        ModalManager.showToast(`Successfully updated tax for ${successCount} products`);
                        modalControl.close();
                    } catch (error) {
                        console.error('Error updating product taxes:', error);
                        errorContainer.textContent = 'Failed to update product taxes. Please try again.';
                        errorContainer.classList.remove('hidden');
                        saveButton.disabled = false;
                        saveButton.textContent = 'Update All Products';
                    }
                });
            }
        });
    };

    // Handle product import
    const handleProductImport = () => {
        if (!ModalManager || !sdk) {
            showToast("System components not loaded. Please try again later.");
            return;
        }

        // Create modal
        const modal = ModalManager.createCenterModal({
            id: 'import-products-modal',
            title: "Bulk Import Products",
            content: `
                <div class="p-4 text-center">
                    <div class="mb-6">
                        <p class="font-medium text-gray-700">Step 1</p>
                        <div class="flex justify-center items-center mt-2">
                            <span class="text-gray-700 mr-2">Download template file:</span>
                            <a href="https://firebasestorage.googleapis.com/v0/b/frihbi-app.appspot.com/o/assets%2FImport%20Product%20Sample%20sheet.xlsx?alt=media" class="text-red-500 font-medium hover:underline" download>Sample.xlsx</a>
                        </div>
                    </div>
                    <div class="mb-6">
                        <p class="font-medium text-gray-700">Step 2</p>
                        <div id="file-upload-area" class="mt-2 border-2 border-dashed border-gray-300 rounded-lg p-6 cursor-pointer hover:bg-gray-50">
                            <i class="ph ph-upload text-gray-400 text-4xl"></i>
                            <p class="mt-2 font-medium">Upload .csv / .xlsx</p>
                            <p class="text-sm text-gray-500">Max file size 20mb and 100 products</p>
                            <input type="file" id="import-file" class="hidden" accept=".csv, .xlsx" />
                        </div>
                    </div>
                </div>
            `,
            actions: `
                <div class="flex justify-center p-4">
                    <button id="start-import-btn" class="px-8 py-3 bg-red-500 text-white rounded-md font-medium">Start</button>
                </div>
            `,
            size: 'md',
            onShown: (modalControl) => {
                const fileUploadArea = document.getElementById('file-upload-area');
                const importFileInput = document.getElementById('import-file');
                const startImportBtn = document.getElementById('start-import-btn');

                let selectedFile = null;

                // Handle file upload area click
                fileUploadArea.addEventListener('click', () => {
                    importFileInput.click();
                });

                // Handle file selection
                importFileInput.addEventListener('change', (e) => {
                    if (e.target.files.length > 0) {
                        selectedFile = e.target.files[0];

                        // Update the upload area UI to show selected file
                        fileUploadArea.innerHTML = `
                            <i class="ph ph-check-circle text-green-500 text-4xl"></i>
                            <p class="mt-2 font-medium">${selectedFile.name}</p>
                            <p class="text-sm text-gray-500">${Math.round(selectedFile.size / 1024)} KB</p>
                            <input type="file" id="import-file" class="hidden" accept=".csv, .xlsx" />
                        `;
                    }
                });

                // Handle import start
                startImportBtn.addEventListener('click', async () => {
                    if (!selectedFile) {
                        ModalManagerast('Please select a file to import');
                        return;
                    }

                    try {
                        // Show loading state
                        startImportBtn.disabled = true;
                        startImportBtn.innerHTML = `
                            <svg class="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            Uploading...
                        `;

                        // Read file as array buffer for Firebase Storage
                        const fileReader = new FileReader();
                        fileReader.onload = async (event) => {
                            try {
                                const fileData = event.target.result;

                                // Generate a unique storage path
                                const storagePath = `seller/${seller.id}/import_product_${Date.now()}.xlsx`;

                                // Get a reference to the storage location
                                const storageRef = sdk.storage.ref(storagePath);

                                // Upload the file
                                await storageRef.put(new Uint8Array(fileData));

                                ModalManagerast('File uploaded successfully. Products will be imported in the background.');
                                modalControl.close();
                            } catch (error) {
                                console.error('Error uploading file:', error);
                                ModalManagerast('Failed to upload file. Please try again.');

                                // Reset button
                                startImportBtn.disabled = false;
                                startImportBtn.textContent = 'Start';
                            }
                        };

                        fileReader.readAsArrayBuffer(selectedFile);
                    } catch (error) {
                        console.error('Error starting import:', error);
                        ModalManagerast('Failed to start import. Please try again.');

                        // Reset button
                        startImportBtn.disabled = false;
                        startImportBtn.textContent = 'Start';
                    }
                });
            }
        });
    };

    // Handle printer management
    const handlePrinterManagement = () => {
        if (!ModalManagerndow.sdk) {
            showToast("System components not loaded. Please try again later.");
            return;
        }

        // Get all available order channels
        const orderChannels = [];

        // Add the Default channel
        orderChannels.push('Default');

        // Add channels from price variants
        if (seller?.priceVariants && Array.isArray(seller.priceVariants)) {
            seller.priceVariants.forEach(variant => {
                if (variant.title && variant.title !== 'Default' && !orderChannels.includes(variant.title)) {
                    orderChannels.push(variant.title);
                }
            });
        }

        // Get managed printers from BluetoothPrinting
        const bluetoothPrinting = BluetoothPrinting;
        const managedPrinters = bluetoothPrinting ? bluetoothPrinting.getSavedPrinters() : [];

        // Get currently connected printer info
        const currentlyConnected = bluetoothPrinting && bluetoothPrinting.connected;
        const connectedDevice = bluetoothPrinting && bluetoothPrinting.device;
        const connectedDeviceId = connectedDevice ? connectedDevice.id : null;
        const connectedDeviceName = connectedDevice ? connectedDevice.name : null;

        // Create modal
        const modal = ModalManagerCenterModal({
            id: 'printer-management-modal',
            title: "Printer Management",
            content: `
                <div class="p-5">
                    <div id="printer-error-container" class="mb-4 hidden p-3 bg-red-50 text-red-700 rounded-lg"></div>
                    
                    <div class="mb-5">
                        <p class="text-sm text-gray-600 leading-relaxed">
                            Configure printers for different order channels. You can assign specific printers for KOT (Kitchen Order Ticket) and bills.
                        </p>
                    </div>
                    
                    <div class="mb-5">
                        <div class="flex items-center">
                            <div class="w-3 h-3 rounded-full ${currentlyConnected ? 'bg-green-500' : 'bg-gray-300'} mr-2"></div>
                            <span class="text-sm ${currentlyConnected ? 'text-green-600' : 'text-gray-500'} font-medium">
                                ${currentlyConnected ? 'Printer Connected' : 'No Printer Connected'}
                            </span>
                        </div>
                    </div>
                    
                    <!-- Printer List -->
                    <div id="printer-list" class="mb-5 space-y-4">
                        ${currentlyConnected && connectedDevice ? `
                        <div class="bg-gradient-to-br from-green-50 to-green-100 rounded-lg p-4 border border-green-200 shadow-sm">
                            <div class="flex items-center justify-between">
                                <div class="flex items-center">
                                    <div class="w-10 h-10 bg-gradient-to-br from-green-100 to-green-200 rounded-lg flex items-center justify-center mr-3 shadow-sm">
                                        <i class="ph ${connectedDevice.type === 'wired' ? 'ph-plug' : 'ph-bluetooth'} text-green-600 text-xl"></i>
                                    </div>
                                    <div>
                                        <h4 class="font-medium text-gray-800 flex items-center">
                                            ${connectedDeviceName || 'Connected Printer'}
                                            <span class="ml-2 px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded-full flex items-center">
                                                <i class="ph ph-plug text-green-600 mr-1 text-xs"></i>Connected Now
                                            </span>
                                        </h4>
                                        <p class="text-xs text-gray-500">
                                            ${connectedDevice.type === 'wired'
                        ? `Address: ${connectedDevice.address || 'Unknown'}`
                        : `ID: ${connectedDeviceId || 'Unknown'}`
                    }
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>
                        ` : ''}
                        
                        ${!managedPrinters.length && !currentlyConnected ? `
                            <div class="text-center py-8 bg-gradient-to-br from-gray-50 to-white rounded-lg border border-dashed border-gray-300">
                                <div class="w-16 h-16 bg-white rounded-full flex items-center justify-center mx-auto mb-3 shadow-sm">
                                    <i class="ph ph-printer text-gray-400 text-3xl"></i>
                                </div>
                                <p class="text-gray-500 mb-1">No printers configured</p>
                                <p class="text-xs text-gray-400">Connect a Bluetooth printer to get started</p>
                            </div>
                        ` : ''}
                        
                        ${managedPrinters.map((printer, index) => {
                        // Determine if this printer is connected - check both id and name
                        const isPrinterConnected = currentlyConnected && (
                            (connectedDeviceId && printer.deviceId === connectedDeviceId) ||
                            (connectedDeviceName && printer.deviceName === connectedDeviceName)
                        );

                        // Skip if this is already shown as the connected printer
                        if (isPrinterConnected && currentlyConnected && connectedDevice) {
                            return '';
                        }

                        // Format date added or last connected date
                        let dateInfo = '';
                        if (printer.lastConnected) {
                            const lastConnectedDate = new Date(printer.lastConnected);
                            const now = new Date();
                            const diffMs = now - lastConnectedDate;
                            const diffMins = Math.round(diffMs / 60000);
                            const diffHours = Math.round(diffMs / 3600000);
                            const diffDays = Math.round(diffMs / 86400000);

                            if (diffMins < 1) {
                                dateInfo = `Connected just now`;
                            } else if (diffMins < 60) {
                                dateInfo = `Connected ${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
                            } else if (diffHours < 24) {
                                dateInfo = `Connected ${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
                            } else {
                                dateInfo = `Connected ${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
                            }
                        } else if (printer.dateAdded) {
                            const addedDate = new Date(printer.dateAdded);
                            dateInfo = `Added on ${addedDate.toLocaleDateString()}`;
                        }

                        // Determine printer type (for backward compatibility)
                        const printerType = printer.type || (printer.deviceId ? 'bluetooth' : 'wired');
                        const isBluetoothPrinter = printerType === 'bluetooth';

                        // Choose icon and background color based on printer type
                        const iconClass = isBluetoothPrinter ? 'ph-bluetooth' : 'ph-plug';
                        const bgColorClass = isBluetoothPrinter ? 'from-blue-50 to-blue-100' : 'from-green-50 to-green-100';
                        const textColorClass = isBluetoothPrinter ? 'text-blue-500' : 'text-green-500';

                        return `
                                <div class="printer-item bg-gradient-to-br from-white to-gray-50 border ${isPrinterConnected ? 'border-green-300 ring-1 ring-green-300' : 'border-gray-200'} rounded-lg shadow-sm p-4 transition-all hover:shadow-md" data-printer-id="${printer.id}">
                                    <div class="flex justify-between items-start mb-3">
                                        <div class="flex items-center">
                                            <div class="w-10 h-10 bg-gradient-to-br ${bgColorClass} rounded-lg flex items-center justify-center mr-3 shadow-sm">
                                                <i class="ph ${iconClass} ${textColorClass} text-xl"></i>
                                            </div>
                                            <div>
                                                <h4 class="font-medium text-gray-800">${printer.name || 'Unnamed Printer'}</h4>
                                                <p class="text-xs text-gray-500">
                                                    ${isBluetoothPrinter
                                ? `${printer.deviceName || 'Unknown device'}`
                                : `${printer.address || 'No address'}`
                            }
                                                </p>
                                                ${dateInfo ? `<p class="text-xs text-gray-500 italic">${dateInfo}</p>` : ''}
                                            </div>
                                            ${printer.isDefault ? `<span class="ml-2 px-2 py-0.5 bg-gradient-to-r from-red-100 to-red-50 text-red-700 text-xs rounded-full flex items-center"><i class="ph ph-star-fill text-amber-500 mr-1 text-xs"></i>Default</span>` : ''}
                                            ${isPrinterConnected ? `<span class="ml-2 px-2 py-0.5 bg-gradient-to-r from-green-100 to-green-50 text-green-700 text-xs rounded-full flex items-center"><i class="ph ph-plug text-green-500 mr-1 text-xs"></i>Connected</span>` : ''}
                                        </div>
                                        <div class="flex space-x-1">
                                            <button class="printer-edit-btn p-2 text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-100 transition-colors" data-printer-id="${printer.id}" title="Edit printer">
                                                <i class="ph ph-pencil-simple"></i>
                                            </button>
                                            <button class="printer-remove-btn p-2 text-gray-400 hover:text-red-500 rounded-full hover:bg-gray-100 transition-colors" data-printer-id="${printer.id}" title="Remove printer">
                                                <i class="ph ph-trash"></i>
                                            </button>
                                        </div>
                                    </div>
                                    
                                    <!-- Assignments -->
                                    <div class="mt-3 pt-3 border-t border-gray-200">
                                        <h5 class="text-sm font-medium text-gray-700 mb-2 flex items-center">
                                            <i class="ph ph-link text-gray-400 mr-1.5"></i>
                                            Channel Assignments
                                        </h5>
                                        ${printer.assignments && printer.assignments.length > 0 ? `
                                            <div class="flex flex-wrap gap-2">
                                                ${printer.assignments.map(assignment => `
                                                    <div class="inline-flex items-center px-2 py-1 bg-gradient-to-r from-gray-100 to-gray-50 text-xs rounded-md border border-gray-100 shadow-sm">
                                                        <span class="font-medium">${assignment.channel}</span>
                                                        <span class="mx-1 text-gray-400">•</span>
                                                        <span class="text-${assignment.printType === 'all' ? 'blue' : assignment.printType === 'kot' ? 'green' : 'orange'}-500">
                                                            ${assignment.printType === 'all' ? 'All' : assignment.printType === 'kot' ? 'KOT' : 'Bill'}
                                                        </span>
                                                    </div>
                                                `).join('')}
                                            </div>
                                        ` : `
                                            <p class="text-xs text-gray-500 flex items-center">
                                                <i class="ph ph-info text-gray-400 mr-1"></i>
                                                No channel assignments
                                            </p>
                                        `}
                                    </div>
                                </div>
                            `;
                    }).join('')}
                    </div>
                    
                    <!-- Add Printer Button -->
                    <button id="add-printer-btn" class="w-full py-3 border border-dashed border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50 hover:shadow-sm transition-all flex items-center justify-center gap-2 bg-gradient-to-r from-white to-gray-50">
                        <i class="ph ph-plus-circle"></i>
                        Add New Printer
                    </button>
                </div>
            `,
            actions: `
                <div class="flex justify-end px-5 py-4 bg-gradient-to-r from-gray-50 to-white border-t border-gray-100">
                    <button id="close-printer-management-btn" class="px-4 py-2 border border-gray-200 rounded-md hover:bg-gray-50 transition-colors flex items-center gap-2 text-gray-600">
                        <i class="ph ph-x"></i>
                        Close
                    </button>
                </div>
            `,
            size: 'lg',
            onShown: (modalControl) => {
                const errorContainer = document.getElementById('printer-error-container');
                const addPrinterBtn = document.getElementById('add-printer-btn');
                const closePrinterManagementBtn = document.getElementById('close-printer-management-btn');

                // Add printer event handler
                addPrinterBtn.addEventListener('click', () => {
                    showAddPrinterModal(modalControl);
                });

                // Close button event handler
                closePrinterManagementBtn.addEventListener('click', () => {
                    modalControl.close();
                });

                // Edit printer event handlers
                document.querySelectorAll('.printer-edit-btn').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const printerId = btn.getAttribute('data-printer-id');
                        showEditPrinterModal(printerId, modalControl);
                    });
                });

                // Remove printer event handlers
                document.querySelectorAll('.printer-remove-btn').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const printerId = btn.getAttribute('data-printer-id');
                        removePrinter(printerId, modalControl);
                    });
                });
            }
        });
    };

    // Show add printer modal
    const showAddPrinterModal = (parentModalControl) => {
        // Get all available order channels
        const orderChannels = ['All Channels', 'Default'];

        // Add channels from price variants
        if (seller?.priceVariants && Array.isArray(seller.priceVariants)) {
            seller.priceVariants.forEach(variant => {
                if (variant.title && variant.title !== 'Default' && !orderChannels.includes(variant.title)) {
                    orderChannels.push(variant.title);
                }
            });
        }

        // Create modal
        const modal = ModalManagerCenterModal({
            id: 'add-printer-modal',
            title: "Add Printer",
            content: `
                <div class="p-5 pt-4">
                    <div id="add-printer-error-container" class="mb-4 hidden p-3 bg-red-50 text-red-700 rounded-lg"></div>
                    
                    <div class="mb-6">
                        <label class="block text-sm font-medium text-gray-700 mb-1.5">
                            <i class="ph ph-tag text-gray-400 mr-1.5"></i>
                            Printer Name
                        </label>
                        <input
                            type="text"
                            id="printer-name-input"
                            class="w-full px-3 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 bg-gradient-to-r from-white to-gray-50 shadow-sm"
                            placeholder="e.g. Kitchen Printer"
                        />
                    </div>
                    
                    <div class="mb-6">
                        <label class="block text-sm font-medium text-gray-700 mb-1.5">
                            <i class="ph ph-printer text-gray-400 mr-1.5"></i>
                            Printer Type
                        </label>
                        <div class="grid grid-cols-2 gap-3">
                            <label class="flex items-center border rounded-lg p-3 cursor-pointer hover:bg-gray-50 transition-colors">
                                <input type="radio" name="printer-type" value="bluetooth" class="w-4 h-4 text-red-600" checked>
                                <div class="ml-2">
                                    <div class="font-medium text-sm">Bluetooth</div>
                                    <div class="text-xs text-gray-500">Wireless printer</div>
                                </div>
                            </label>
                            <label class="flex items-center border rounded-lg p-3 cursor-pointer hover:bg-gray-50 transition-colors">
                                <input type="radio" name="printer-type" value="wired" class="w-4 h-4 text-red-600">
                                <div class="ml-2">
                                    <div class="font-medium text-sm">Wired</div>
                                    <div class="text-xs text-gray-500">USB/Network printer</div>
                                </div>
                            </label>
                        </div>
                    </div>
                    
                    <div id="bluetooth-device-section" class="mb-6">
                        <div class="flex items-center justify-between mb-1.5">
                            <label class="block text-sm font-medium text-gray-700">
                                <i class="ph ph-bluetooth text-gray-400 mr-1.5"></i>
                                Bluetooth Device
                            </label>
                            <button id="select-device-btn" class="text-xs text-red-500 hover:text-red-600 flex items-center gap-1 transition-colors">
                                <i class="ph ph-scan"></i>
                                Select Device
                            </button>
                        </div>
                        <div id="selected-device-container" class="border rounded-lg p-4 flex items-center justify-between bg-gradient-to-r from-gray-50 to-white shadow-sm">
                            <div id="no-device-selected" class="text-gray-500 text-sm flex items-center">
                                <i class="ph ph-bluetooth-x text-gray-400 mr-2"></i>
                                No device selected
                            </div>
                            <div id="device-info" class="hidden">
                                <div class="flex items-center">
                                    <div class="w-8 h-8 bg-blue-50 rounded-full flex items-center justify-center mr-2 shadow-sm">
                                        <i class="ph ph-bluetooth text-blue-500"></i>
                                    </div>
                                    <div>
                                        <div id="device-name" class="font-medium"></div>
                                        <div id="device-id" class="text-xs text-gray-500"></div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <div id="wired-device-section" class="mb-6 hidden">
                        <div class="flex items-center justify-between mb-1.5">
                            <label class="block text-sm font-medium text-gray-700">
                                <i class="ph ph-plug text-gray-400 mr-1.5"></i>
                                Printer Address
                            </label>
                        </div>
                        <input
                            type="text"
                            id="wired-address-input"
                            class="w-full px-3 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 bg-gradient-to-r from-white to-gray-50 shadow-sm"
                            placeholder="e.g. 192.168.1.100 or USB port"
                        />
                        <p class="text-xs text-gray-500 mt-1">Enter IP address for network printers or port identifier for USB printers</p>
                    </div>
                    
                    <div class="mb-3">
                        <label class="flex items-center p-2 hover:bg-gray-50 rounded-md cursor-pointer transition-colors">
                            <input
                                type="checkbox"
                                id="is-default-printer-input"
                                class="w-4 h-4 text-red-600 rounded focus:ring-red-500"
                            />
                            <div class="ml-2">
                                <div class="text-sm text-gray-700 font-medium">Set as default printer</div>
                                <div class="text-xs text-gray-500">This printer will be used when no specific printer is assigned</div>
                            </div>
                        </label>
                    </div>
                    
                    <div class="mb-5">
                        <label class="flex items-center p-2 hover:bg-gray-50 rounded-md cursor-pointer transition-colors">
                            <input
                                type="checkbox"
                                id="add-assignments-input"
                                class="w-4 h-4 text-red-600 rounded focus:ring-red-500"
                            />
                            <div class="ml-2">
                                <div class="text-sm text-gray-700 font-medium">Add channel assignments</div>
                                <div class="text-xs text-gray-500">Configure which channels and print types use this printer</div>
                            </div>
                        </label>
                    </div>
                    
                    <div id="assignments-container" class="hidden space-y-4 p-4 border border-gray-200 rounded-lg bg-gradient-to-r from-gray-50 to-white shadow-sm">
                        <div id="assignments-list" class="space-y-4">
                            <div class="assignment-entry grid grid-cols-2 gap-4">
                                <div>
                                    <label class="block text-xs font-medium text-gray-700 mb-1.5 flex items-center">
                                        <i class="ph ph-storefront text-gray-400 mr-1"></i>
                                        Channel
                                    </label>
                                    <select class="assignment-channel w-full px-3 py-2 border rounded-lg text-sm bg-white shadow-sm focus:ring-2 focus:ring-red-500 focus:outline-none">
                                        ${orderChannels.map(channel => `
                                            <option value="${channel}">${channel}</option>
                                        `).join('')}
                                    </select>
                                </div>
                                <div>
                                    <label class="block text-xs font-medium text-gray-700 mb-1.5 flex items-center">
                                        <i class="ph ph-printer text-gray-400 mr-1"></i>
                                        Print Type
                                    </label>
                                    <select class="assignment-type w-full px-3 py-2 border rounded-lg text-sm bg-white shadow-sm focus:ring-2 focus:ring-red-500 focus:outline-none">
                                        <option value="all">All</option>
                                        <option value="kot">KOT Only</option>
                                        <option value="bill">Bill Only</option>
                                    </select>
                                </div>
                            </div>
                        </div>
                        
                        <button id="add-assignment-btn" class="w-full py-2 border border-dashed border-gray-300 text-gray-600 rounded-md hover:bg-gray-50 hover:shadow-sm transition-all flex items-center justify-center text-sm gap-1">
                            <i class="ph ph-plus-circle"></i>
                            Add Another Assignment
                        </button>
                    </div>
                </div>
            `,
            actions: `
                <div class="flex justify-end px-5 py-4 space-x-3 bg-gradient-to-r from-gray-50 to-white border-t border-gray-100">
                    <button id="cancel-add-printer-btn" class="px-4 py-2 border border-gray-200 rounded-md hover:bg-gray-50 transition-colors flex items-center gap-2 text-gray-600">
                        <i class="ph ph-x"></i>
                        Cancel
                    </button>
                    <button id="save-add-printer-btn" class="px-4 py-2 bg-gradient-to-r from-red-500 to-red-600 text-white rounded-md hover:from-red-600 hover:to-red-700 transition-colors flex items-center gap-2 shadow-sm">
                        <i class="ph ph-check"></i>
                        Add Printer
                    </button>
                </div>
            `,
            size: 'md',
            onShown: (modalControl) => {
                const errorContainer = document.getElementById('add-printer-error-container');
                const printerNameInput = document.getElementById('printer-name-input');
                const printerTypeRadios = document.querySelectorAll('input[name="printer-type"]');
                const bluetoothSection = document.getElementById('bluetooth-device-section');
                const wiredSection = document.getElementById('wired-device-section');
                const wiredAddressInput = document.getElementById('wired-address-input');
                const selectDeviceBtn = document.getElementById('select-device-btn');
                const deviceInfoDiv = document.getElementById('device-info');
                const noDeviceSelectedDiv = document.getElementById('no-device-selected');
                const deviceNameDiv = document.getElementById('device-name');
                const deviceIdDiv = document.getElementById('device-id');
                const isDefaultPrinterInput = document.getElementById('is-default-printer-input');
                const addAssignmentsInput = document.getElementById('add-assignments-input');
                const assignmentsContainer = document.getElementById('assignments-container');
                const assignmentsList = document.getElementById('assignments-list');
                const addAssignmentBtn = document.getElementById('add-assignment-btn');
                const cancelButton = document.getElementById('cancel-add-printer-btn');
                const saveButton = document.getElementById('save-add-printer-btn');

                let selectedDevice = null;
                let printerType = 'bluetooth'; // Default printer type

                // Handle printer type change
                printerTypeRadios.forEach(radio => {
                    radio.addEventListener('change', () => {
                        printerType = radio.value;
                        bluetoothSection.classList.toggle('hidden', printerType !== 'bluetooth');
                        wiredSection.classList.toggle('hidden', printerType !== 'wired');

                        // Reset device selection when switching types
                        if (printerType === 'wired') {
                            selectedDevice = null;
                        }
                    });
                });

                // Show/hide assignments based on checkbox
                addAssignmentsInput.addEventListener('change', () => {
                    assignmentsContainer.classList.toggle('hidden', !addAssignmentsInput.checked);
                });

                // Add assignment button event handler
                addAssignmentBtn.addEventListener('click', () => {
                    const assignmentEntry = document.createElement('div');
                    assignmentEntry.className = 'assignment-entry grid grid-cols-2 gap-4 relative';
                    assignmentEntry.innerHTML = `
                        <div>
                            <label class="block text-xs font-medium text-gray-700 mb-1">
                                Channel
                            </label>
                            <select class="assignment-channel w-full px-3 py-2 border rounded-md text-sm">
                                ${orderChannels.map(channel => `
                                    <option value="${channel}">${channel}</option>
                                `).join('')}
                            </select>
                        </div>
                        <div>
                            <label class="block text-xs font-medium text-gray-700 mb-1">
                                Print Type
                            </label>
                            <div class="flex">
                                <select class="assignment-type w-full px-3 py-2 border rounded-md text-sm">
                                    <option value="all">All</option>
                                    <option value="kot">KOT Only</option>
                                    <option value="bill">Bill Only</option>
                                </select>
                                <button class="remove-assignment-btn ml-2 p-1 text-gray-400 hover:text-red-500 rounded hover:bg-gray-100">
                                    <i class="ph ph-x"></i>
                                </button>
                            </div>
                        </div>
                    `;

                    assignmentsList.appendChild(assignmentEntry);

                    // Add event listener to the remove button
                    assignmentEntry.querySelector('.remove-assignment-btn').addEventListener('click', () => {
                        assignmentEntry.remove();
                    });
                });

                // Select device button event handler
                selectDeviceBtn.addEventListener('click', async () => {
                    try {
                        errorContainer.classList.add('hidden');

                        if (!BluetoothPrinting) {
                            throw new Error('Bluetooth printing service not available');
                        }

                        const bluetoothPrinting = BluetoothPrinting;

                        // Check if the browser supports Web Bluetooth
                        if (!bluetoothPrinting.isSupported()) {
                            throw new Error('Web Bluetooth is not supported in this browser');
                        }

                        // Request a Bluetooth device
                        const device = await navigator.bluetooth.requestDevice({
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

                        // Set the selected device
                        selectedDevice = {
                            id: device.id,
                            name: device.name || 'Unknown Device'
                        };

                        // Update the UI
                        deviceNameDiv.textContent = selectedDevice.name;
                        deviceIdDiv.textContent = selectedDevice.id;
                        deviceInfoDiv.classList.remove('hidden');
                        noDeviceSelectedDiv.classList.add('hidden');

                        // Set printer name if empty
                        if (!printerNameInput.value) {
                            printerNameInput.value = selectedDevice.name;
                        }

                    } catch (error) {
                        console.error('Error selecting device:', error);
                        errorContainer.textContent = `Error: ${error.message}`;
                        errorContainer.classList.remove('hidden');
                    }
                });

                // Cancel button event handler
                cancelButton.addEventListener('click', () => {
                    modalControl.close();
                });

                // Save button event handler
                saveButton.addEventListener('click', async () => {
                    try {
                        // Basic validation
                        if (!printerNameInput.value.trim()) {
                            errorContainer.textContent = 'Please enter a printer name';
                            errorContainer.classList.remove('hidden');
                            return;
                        }

                        if (printerType === 'bluetooth' && !selectedDevice) {
                            errorContainer.textContent = 'Please select a Bluetooth device';
                            errorContainer.classList.remove('hidden');
                            return;
                        }

                        if (printerType === 'wired' && !wiredAddressInput.value.trim()) {
                            errorContainer.textContent = 'Please enter printer address';
                            errorContainer.classList.remove('hidden');
                            return;
                        }

                        // Collect assignments if enabled
                        const assignments = [];
                        if (addAssignmentsInput.checked) {
                            const assignmentEntries = assignmentsList.querySelectorAll('.assignment-entry');
                            assignmentEntries.forEach(entry => {
                                const channelSelect = entry.querySelector('.assignment-channel');
                                const typeSelect = entry.querySelector('.assignment-type');

                                if (channelSelect && typeSelect) {
                                    assignments.push({
                                        channel: channelSelect.value,
                                        printType: typeSelect.value
                                    });
                                }
                            });
                        }

                        // Create the printer object
                        const printer = {
                            name: printerNameInput.value.trim(),
                            type: printerType,
                            assignments: assignments,
                            dateAdded: new Date().toISOString()
                        };

                        // Add device-specific properties based on printer type
                        if (printerType === 'bluetooth' && selectedDevice) {
                            printer.deviceId = selectedDevice.id;
                            printer.deviceName = selectedDevice.name;
                        } else if (printerType === 'wired') {
                            printer.address = wiredAddressInput.value.trim();
                        }

                        // Add the printer to the managed printers list
                        if (BluetoothPrinting) {
                            const bluetoothPrinting = BluetoothPrinting;
                            bluetoothPrinting.addPrinter(printer, isDefaultPrinterInput.checked);

                            // Show success message
                            ModalManagerast('Printer added successfully');

                            // Close the modal
                            modalControl.close();

                            // Refresh the parent modal
                            parentModalControl.close();
                            handlePrinterManagement();
                        } else {
                            throw new Error('Bluetooth printing service not available');
                        }
                    } catch (error) {
                        console.error('Error saving printer:', error);
                        errorContainer.textContent = `Error: ${error.message}`;
                        errorContainer.classList.remove('hidden');
                    }
                });
            }
        });
    };

    // Show edit printer modal
    const showEditPrinterModal = (printerId, parentModalControl) => {
        // Get the printer from BluetoothPrinting
        const bluetoothPrinting = BluetoothPrinting;
        if (!bluetoothPrinting) {
            ModalManagerast('Bluetooth printing service not available', 'error');
            return;
        }

        const printers = bluetoothPrinting.getSavedPrinters();
        const printer = printers.find(p => p.id === printerId);

        if (!printer) {
            ModalManagerast('Printer not found', 'error');
            return;
        }

        // Get all available order channels
        const orderChannels = ['All Channels', 'Default'];

        // Add channels from price variants
        if (seller?.priceVariants && Array.isArray(seller.priceVariants)) {
            seller.priceVariants.forEach(variant => {
                if (variant.title && variant.title !== 'Default' && !orderChannels.includes(variant.title)) {
                    orderChannels.push(variant.title);
                }
            });
        }

        // Determine printer type (for backward compatibility)
        const printerType = printer.type || (printer.deviceId ? 'bluetooth' : 'wired');

        // Create modal
        const modal = ModalManagerCenterModal({
            id: 'edit-printer-modal',
            title: "Edit Printer",
            content: `
                <div class="p-5 pt-4">
                    <div id="edit-printer-error-container" class="mb-4 hidden p-3 bg-red-50 text-red-700 rounded-lg"></div>
                    
                    <div class="mb-6">
                        <label class="block text-sm font-medium text-gray-700 mb-1.5">
                            <i class="ph ph-tag text-gray-400 mr-1.5"></i>
                            Printer Name
                        </label>
                        <input
                            type="text"
                            id="edit-printer-name-input"
                            class="w-full px-3 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 bg-gradient-to-r from-white to-gray-50 shadow-sm"
                            value="${printer.name || ''}"
                            placeholder="e.g. Kitchen Printer"
                        />
                    </div>
                    
                    <div class="mb-6">
                        <label class="block text-sm font-medium text-gray-700 mb-1.5">
                            <i class="ph ph-printer text-gray-400 mr-1.5"></i>
                            Printer Type
                        </label>
                        <div class="grid grid-cols-2 gap-3">
                            <label class="flex items-center border rounded-lg p-3 cursor-pointer hover:bg-gray-50 transition-colors">
                                <input type="radio" name="printer-type" value="bluetooth" class="w-4 h-4 text-red-600" ${printerType === 'bluetooth' ? 'checked' : ''}>
                                <div class="ml-2">
                                    <div class="font-medium text-sm">Bluetooth</div>
                                    <div class="text-xs text-gray-500">Wireless printer</div>
                                </div>
                            </label>
                            <label class="flex items-center border rounded-lg p-3 cursor-pointer hover:bg-gray-50 transition-colors">
                                <input type="radio" name="printer-type" value="wired" class="w-4 h-4 text-red-600" ${printerType === 'wired' ? 'checked' : ''}>
                                <div class="ml-2">
                                    <div class="font-medium text-sm">Wired</div>
                                    <div class="text-xs text-gray-500">USB/Network printer</div>
                                </div>
                            </label>
                        </div>
                    </div>
                    
                    <div id="edit-bluetooth-section" class="mb-6 ${printerType !== 'bluetooth' ? 'hidden' : ''}">
                        <div class="flex items-center justify-between mb-1.5">
                            <label class="block text-sm font-medium text-gray-700">
                                <i class="ph ph-bluetooth text-gray-400 mr-1.5"></i>
                                Bluetooth Device
                            </label>
                        </div>
                        <div id="selected-device-container" class="border rounded-lg p-4 flex items-center justify-between bg-gradient-to-r from-gray-50 to-white shadow-sm">
                            <div class="flex items-center">
                                <div class="w-8 h-8 bg-blue-50 rounded-full flex items-center justify-center mr-2 shadow-sm">
                                    <i class="ph ph-bluetooth text-blue-500"></i>
                                </div>
                                <div>
                                    <div class="font-medium">${printer.deviceName || 'Unknown Device'}</div>
                                    <div class="text-xs text-gray-500">${printer.deviceId || ''}</div>
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <div id="edit-wired-section" class="mb-6 ${printerType !== 'wired' ? 'hidden' : ''}">
                        <div class="flex items-center justify-between mb-1.5">
                            <label class="block text-sm font-medium text-gray-700">
                                <i class="ph ph-plug text-gray-400 mr-1.5"></i>
                                Printer Address
                            </label>
                        </div>
                        <input
                            type="text"
                            id="edit-wired-address-input"
                            class="w-full px-3 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 bg-gradient-to-r from-white to-gray-50 shadow-sm"
                            value="${printer.address || ''}"
                            placeholder="e.g. 192.168.1.100 or USB port"
                        />
                        <p class="text-xs text-gray-500 mt-1">Enter IP address for network printers or port identifier for USB printers</p>
                    </div>
                    
                    <div class="mb-4">
                        <label class="flex items-center p-2 hover:bg-gray-50 rounded-md cursor-pointer transition-colors">
                            <input
                                type="checkbox"
                                id="edit-is-default-printer-input"
                                class="w-4 h-4 text-red-600 rounded focus:ring-red-500"
                                ${printer.isDefault ? 'checked' : ''}
                            />
                            <div class="ml-2">
                                <div class="text-sm text-gray-700 font-medium">Set as default printer</div>
                                <div class="text-xs text-gray-500">This printer will be used when no specific printer is assigned</div>
                            </div>
                        </label>
                    </div>
                    
                    <div class="mb-5">
                        <h5 class="text-sm font-medium text-gray-700 mb-2 flex items-center">
                            <i class="ph ph-link text-gray-400 mr-1.5"></i>
                            Channel Assignments
                        </h5>
                    </div>
                    
                    <div id="edit-assignments-container" class="space-y-4 p-4 border border-gray-200 rounded-lg bg-gradient-to-r from-gray-50 to-white shadow-sm">
                        <div id="edit-assignments-list" class="space-y-4">
                            ${(printer.assignments || []).map((assignment, index) => `
                                <div class="assignment-entry grid grid-cols-2 gap-4 relative" data-index="${index}">
                                    <div>
                                        <label class="block text-xs font-medium text-gray-700 mb-1.5 flex items-center">
                                            <i class="ph ph-storefront text-gray-400 mr-1"></i>
                                            Channel
                                        </label>
                                        <select class="assignment-channel w-full px-3 py-2 border rounded-lg text-sm bg-white shadow-sm focus:ring-2 focus:ring-red-500 focus:outline-none">
                                            ${orderChannels.map(channel => `
                                                <option value="${channel}" ${assignment.channel === channel ? 'selected' : ''}>${channel}</option>
                                            `).join('')}
                                        </select>
                                    </div>
                                    <div>
                                        <label class="block text-xs font-medium text-gray-700 mb-1.5 flex items-center">
                                            <i class="ph ph-printer text-gray-400 mr-1"></i>
                                            Print Type
                                        </label>
                                        <div class="flex">
                                            <select class="assignment-type w-full px-3 py-2 border rounded-lg text-sm bg-white shadow-sm focus:ring-2 focus:ring-red-500 focus:outline-none">
                                                <option value="all" ${assignment.printType === 'all' ? 'selected' : ''}>All</option>
                                                <option value="kot" ${assignment.printType === 'kot' ? 'selected' : ''}>KOT Only</option>
                                                <option value="bill" ${assignment.printType === 'bill' ? 'selected' : ''}>Bill Only</option>
                                            </select>
                                            <button class="remove-assignment-btn ml-2 p-2 text-gray-400 hover:text-red-500 rounded-lg hover:bg-gray-100 transition-colors">
                                                <i class="ph ph-x"></i>
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                        
                        <button id="edit-add-assignment-btn" class="w-full py-2 border border-dashed border-gray-300 text-gray-600 rounded-md hover:bg-gray-50 hover:shadow-sm transition-all flex items-center justify-center text-sm gap-1">
                            <i class="ph ph-plus-circle"></i>
                            Add Assignment
                        </button>
                    </div>
                </div>
            `,
            actions: `
                <div class="flex justify-end px-5 py-4 space-x-3 bg-gradient-to-r from-gray-50 to-white border-t border-gray-100">
                    <button id="cancel-edit-printer-btn" class="px-4 py-2 border border-gray-200 rounded-md hover:bg-gray-50 transition-colors flex items-center gap-2 text-gray-600">
                        <i class="ph ph-x"></i>
                        Cancel
                    </button>
                    <button id="save-edit-printer-btn" class="px-4 py-2 bg-gradient-to-r from-red-500 to-red-600 text-white rounded-md hover:from-red-600 hover:to-red-700 transition-colors flex items-center gap-2 shadow-sm">
                        <i class="ph ph-check"></i>
                        Save Changes
                    </button>
                </div>
            `,
            size: 'md',
            onShown: (modalControl) => {
                const errorContainer = document.getElementById('edit-printer-error-container');
                const printerNameInput = document.getElementById('edit-printer-name-input');
                const printerTypeRadios = document.querySelectorAll('input[name="printer-type"]');
                const bluetoothSection = document.getElementById('edit-bluetooth-section');
                const wiredSection = document.getElementById('edit-wired-section');
                const wiredAddressInput = document.getElementById('edit-wired-address-input');
                const isDefaultPrinterInput = document.getElementById('edit-is-default-printer-input');
                const assignmentsList = document.getElementById('edit-assignments-list');
                const addAssignmentBtn = document.getElementById('edit-add-assignment-btn');
                const cancelButton = document.getElementById('cancel-edit-printer-btn');
                const saveButton = document.getElementById('save-edit-printer-btn');

                // Track current printer type
                let currentPrinterType = printerType;

                // Handle printer type change
                printerTypeRadios.forEach(radio => {
                    radio.addEventListener('change', () => {
                        currentPrinterType = radio.value;
                        bluetoothSection.classList.toggle('hidden', currentPrinterType !== 'bluetooth');
                        wiredSection.classList.toggle('hidden', currentPrinterType !== 'wired');
                    });
                });

                // Add assignment button event handler
                addAssignmentBtn.addEventListener('click', () => {
                    const assignmentEntry = document.createElement('div');
                    assignmentEntry.className = 'assignment-entry grid grid-cols-2 gap-4 relative';
                    assignmentEntry.innerHTML = `
                        <div>
                            <label class="block text-xs font-medium text-gray-700 mb-1.5 flex items-center">
                                <i class="ph ph-storefront text-gray-400 mr-1"></i>
                                Channel
                            </label>
                            <select class="assignment-channel w-full px-3 py-2 border rounded-lg text-sm bg-white shadow-sm focus:ring-2 focus:ring-red-500 focus:outline-none">
                                ${orderChannels.map(channel => `
                                    <option value="${channel}">${channel}</option>
                                `).join('')}
                            </select>
                        </div>
                        <div>
                            <label class="block text-xs font-medium text-gray-700 mb-1.5 flex items-center">
                                <i class="ph ph-printer text-gray-400 mr-1"></i>
                                Print Type
                            </label>
                            <div class="flex">
                                <select class="assignment-type w-full px-3 py-2 border rounded-lg text-sm bg-white shadow-sm focus:ring-2 focus:ring-red-500 focus:outline-none">
                                    <option value="all">All</option>
                                    <option value="kot">KOT Only</option>
                                    <option value="bill">Bill Only</option>
                                </select>
                                <button class="remove-assignment-btn ml-2 p-2 text-gray-400 hover:text-red-500 rounded-lg hover:bg-gray-100 transition-colors">
                                    <i class="ph ph-x"></i>
                                </button>
                            </div>
                        </div>
                    `;

                    assignmentsList.appendChild(assignmentEntry);

                    // Add event listener to the remove button
                    assignmentEntry.querySelector('.remove-assignment-btn').addEventListener('click', () => {
                        assignmentEntry.remove();
                    });
                });

                // Add event listeners to existing remove buttons
                document.querySelectorAll('.remove-assignment-btn').forEach(btn => {
                    btn.addEventListener('click', () => {
                        btn.closest('.assignment-entry').remove();
                    });
                });

                // Cancel button event handler
                cancelButton.addEventListener('click', () => {
                    modalControl.close();
                });

                // Save button event handler
                saveButton.addEventListener('click', async () => {
                    try {
                        // Basic validation
                        if (!printerNameInput.value.trim()) {
                            errorContainer.textContent = 'Please enter a printer name';
                            errorContainer.classList.remove('hidden');
                            return;
                        }

                        if (currentPrinterType === 'wired' && !wiredAddressInput.value.trim()) {
                            errorContainer.textContent = 'Please enter printer address';
                            errorContainer.classList.remove('hidden');
                            return;
                        }

                        // Collect assignments
                        const assignments = [];
                        const assignmentEntries = assignmentsList.querySelectorAll('.assignment-entry');
                        assignmentEntries.forEach(entry => {
                            const channelSelect = entry.querySelector('.assignment-channel');
                            const typeSelect = entry.querySelector('.assignment-type');

                            if (channelSelect && typeSelect) {
                                assignments.push({
                                    channel: channelSelect.value,
                                    printType: typeSelect.value
                                });
                            }
                        });

                        // Create the update object with common properties
                        const updates = {
                            name: printerNameInput.value.trim(),
                            type: currentPrinterType,
                            assignments: assignments,
                            isDefault: isDefaultPrinterInput.checked,
                            dateModified: new Date().toISOString()
                        };

                        // Add type-specific properties
                        if (currentPrinterType === 'wired') {
                            updates.address = wiredAddressInput.value.trim();
                            // Remove bluetooth-specific properties if switching from bluetooth to wired
                            if (printerType === 'bluetooth') {
                                updates.deviceId = null;
                                updates.deviceName = null;
                            }
                        } else if (currentPrinterType === 'bluetooth') {
                            // Keep existing Bluetooth device info
                            if (printerType === 'wired') {
                                // If switching from wired to bluetooth without a device, show error
                                if (!printer.deviceId) {
                                    errorContainer.textContent = 'Cannot switch to Bluetooth without selecting a device';
                                    errorContainer.classList.remove('hidden');
                                    return;
                                }
                            }
                            // Remove wired-specific properties if switching from wired to bluetooth
                            if (printerType === 'wired') {
                                updates.address = null;
                            }
                        }

                        // Update the printer
                        bluetoothPrinting.updatePrinter(printerId, updates);

                        // Show success message
                        ModalManagerast('Printer updated successfully');

                        // Close the modal
                        modalControl.close();

                        // Refresh the parent modal
                        parentModalControl.close();
                        handlePrinterManagement();
                    } catch (error) {
                        console.error('Error updating printer:', error);
                        errorContainer.textContent = `Error: ${error.message}`;
                        errorContainer.classList.remove('hidden');
                    }
                });
            }
        });
    };

    // Remove a printer
    const removePrinter = (printerId, parentModalControl) => {
        // Get the printer service
        const bluetoothPrinting = BluetoothPrinting;
        if (!bluetoothPrinting) {
            ModalManagerast('Bluetooth printing service not available', 'error');
            return;
        }

        // Get the printer details
        const printers = bluetoothPrinting.getSavedPrinters();
        const printer = printers.find(p => p.id === printerId);

        if (!printer) {
            ModalManagerast('Printer not found', 'error');
            return;
        }

        // Confirm deletion with a modal
        const confirmModal = ModalManagerCenterModal({
            id: 'confirm-delete-printer-modal',
            title: "Remove Printer",
            content: `
                <div class="p-5">
                    <div class="flex items-center justify-center mb-5">
                        <div class="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center">
                            <i class="ph ph-warning-circle text-red-500 text-3xl"></i>
                        </div>
                    </div>
                    
                    <h3 class="text-lg font-medium text-gray-800 mb-2 text-center">Are you sure?</h3>
                    
                    <p class="text-gray-600 text-center mb-4">
                        You're about to remove the printer <span class="font-medium text-gray-800">${printer.name || 'Unnamed printer'}</span>.
                        ${printer.isDefault ? '<span class="text-red-500">This is your default printer.</span>' : ''}
                    </p>
                    
                    <div class="bg-gradient-to-r from-amber-50 to-yellow-50 border border-amber-100 rounded-lg p-4 mb-4">
                        <div class="flex items-start">
                            <div class="flex-shrink-0 mt-0.5">
                                <i class="ph ph-info text-amber-500 text-lg"></i>
                            </div>
                            <div class="ml-3">
                                <p class="text-sm text-amber-700">
                                    Any printer assignments to order channels will be removed. This action cannot be undone.
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            `,
            actions: `
                <div class="flex justify-end px-5 py-4 space-x-3 bg-gradient-to-r from-gray-50 to-white border-t border-gray-100">
                    <button id="cancel-delete-printer-btn" class="px-4 py-2 border border-gray-200 rounded-md hover:bg-gray-50 transition-colors flex items-center gap-2 text-gray-600">
                        <i class="ph ph-x"></i>
                        Cancel
                    </button>
                    <button id="confirm-delete-printer-btn" class="px-4 py-2 bg-gradient-to-r from-red-500 to-red-600 text-white rounded-md hover:from-red-600 hover:to-red-700 transition-colors flex items-center gap-2 shadow-sm">
                        <i class="ph ph-trash"></i>
                        Remove Printer
                    </button>
                </div>
            `,
            size: 'sm',
            onShown: (modalControl) => {
                const cancelButton = document.getElementById('cancel-delete-printer-btn');
                const confirmButton = document.getElementById('confirm-delete-printer-btn');

                // Cancel button event handler
                cancelButton.addEventListener('click', () => {
                    modalControl.close();
                });

                // Confirm button event handler
                confirmButton.addEventListener('click', () => {
                    try {
                        // Remove the printer
                        const result = bluetoothPrinting.removePrinter(printerId);

                        if (result) {
                            ModalManagerast('Printer removed successfully');

                            // Close modals
                            modalControl.close();

                            // Refresh the parent modal
                            parentModalControl.close();
                            handlePrinterManagement();
                        } else {
                            ModalManagerast('Failed to remove printer', 'error');
                        }
                    } catch (error) {
                        console.error('Error removing printer:', error);
                        ModalManagerast(`Error: ${error.message}`, 'error');
                    }
                });
            }
        });
    };

    // Render the dashboard
    return (
        <div className="pb-24 md:pb-4 px-4 mt-4">
            {/* View Toggle */}
            <div className="flex items-center justify-between mb-5">
                <h2 className="text-xl font-bold text-gray-800 flex items-center">
                    {activeView === 'dashboard' ? (
                        <>
                            <i className="ph ph-storefront text-red-500 mr-2"></i>
                            Dashboard
                        </>
                    ) : (
                        <>
                            <i className="ph ph-gear text-red-500 mr-2"></i>
                            Settings
                        </>
                    )}
                </h2>
                <div className="flex bg-gray-100 rounded-lg p-1 shadow-sm">
                    <button
                        onClick={() => setActiveView('dashboard')}
                        className={`px-3 py-1.5 rounded-md text-sm font-medium flex items-center gap-1.5 ${activeView === 'dashboard'
                            ? 'bg-white text-red-500 shadow-sm'
                            : 'text-gray-600 hover:text-gray-800'
                            }`}
                    >
                        <i className="ph ph-chart-pie"></i>
                        <span className="hidden sm:inline">Dashboard</span>
                    </button>
                    <button
                        onClick={() => setActiveView('settings')}
                        className={`px-3 py-1.5 rounded-md text-sm font-medium flex items-center gap-1.5 ${activeView === 'settings'
                            ? 'bg-white text-red-500 shadow-sm'
                            : 'text-gray-600 hover:text-gray-800'
                            }`}
                    >
                        <i className="ph ph-gear"></i>
                        <span className="hidden sm:inline">Settings</span>
                    </button>
                </div>
            </div>

            {/* Dashboard View */}
            {activeView === 'dashboard' && (
                <>
                    {/* Orders Dashboard */}
                    <div className="mb-6">
                        <div className="mb-5">
                            <h3 className="text-lg font-semibold text-gray-700">Today's Summary</h3>
                        </div>

                        <div className="overflow-x-auto overflow-visible pb-2 -mx-4 px-4">
                            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3 min-w-[300px]">
                                <DashboardCard
                                    icon="ph-chart-line-up"
                                    title="Today's Orders"
                                    value={formatNumber(dashboardMetrics.todayOrders)}
                                    trend={`${dashboardMetrics.todayOrdersTrend >= 0 ? '+' : ''}${dashboardMetrics.todayOrdersTrend.toFixed(1)}%`}
                                    color={dashboardMetrics.todayOrdersTrend >= 0 ? "primary" : "warning"}
                                    compact={true}
                                />
                                <DashboardCard
                                    icon="ph-currency-dollar"
                                    title="Today's Revenue"
                                    value={formatCurrency(dashboardMetrics.todayRevenue)}
                                    trend={`${dashboardMetrics.todayRevenueTrend >= 0 ? '+' : ''}${dashboardMetrics.todayRevenueTrend.toFixed(1)}%`}
                                    color={dashboardMetrics.todayRevenueTrend >= 0 ? "success" : "warning"}
                                    compact={true}
                                />
                                <DashboardCard
                                    icon="ph-users"
                                    title="New Customers"
                                    value={formatNumber(dashboardMetrics.newCustomers)}
                                    trend={`${dashboardMetrics.newCustomersTrend >= 0 ? '+' : ''}${dashboardMetrics.newCustomersTrend.toFixed(1)}%`}
                                    color={dashboardMetrics.newCustomersTrend >= 0 ? "primary" : "warning"}
                                    compact={true}
                                />
                                <DashboardCard
                                    icon="ph-shopping-cart"
                                    title="Avg. Order Value"
                                    value={formatCurrency(dashboardMetrics.avgOrderValue)}
                                    trend={`${dashboardMetrics.avgOrderValueTrend >= 0 ? '+' : ''}${dashboardMetrics.avgOrderValueTrend.toFixed(1)}%`}
                                    color={dashboardMetrics.avgOrderValueTrend >= 0 ? "info" : "warning"}
                                    compact={true}
                                    className="hidden md:flex"
                                />
                                <DashboardCard
                                    icon="ph-clock"
                                    title="Avg. Service Time"
                                    value={`${Math.round(dashboardMetrics.avgServiceTime)} min`}
                                    trend={`${dashboardMetrics.avgServiceTimeTrend >= 0 ? '+' : ''}${dashboardMetrics.avgServiceTimeTrend.toFixed(1)}%`}
                                    color={dashboardMetrics.avgServiceTimeTrend >= 0 ? "success" : "warning"}
                                    compact={true}
                                    className="hidden lg:flex"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Order Channels Section */}
                    <div className="mb-6 bg-section-bg rounded-xl shadow-section overflow-hidden border border-gray-200">
                        <div className="px-3 py-3 border-b border-gray-200 flex items-center">
                            <i className="ph ph-globe text-red-500 text-xl mr-2"></i>
                            <h2 className="text-lg font-semibold text-gray-800">Order Channels</h2>
                        </div>
                        <div className="p-3">
                            {isLoading ? (
                                <div className="text-center py-10">
                                    <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-red-500 mx-auto"></div>
                                    <p className="mt-3 text-gray-600">Loading orders...</p>
                                </div>
                            ) : error ? (
                                <div className="text-center py-10">
                                    <div className="rounded-full h-10 w-10 bg-red-100 flex items-center justify-center mx-auto">
                                        <i className="ph ph-x text-red-500 text-xl"></i>
                                    </div>
                                    <p className="mt-3 text-gray-600">{error}</p>
                                </div>
                            ) : (
                                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                                    {channels
                                        .filter(channel => channel.isChannel)
                                        .map(channel => (
                                            <div
                                                key={channel.id}
                                                className="mb-2"
                                                onClick={() => handleRoomClick(null, channel.id)}
                                                onContextMenu={(e) => {
                                                    e.preventDefault();
                                                    showRenameRoomModal(null, channel.id);
                                                }}
                                            >
                                                <TableCard
                                                    title={channel.title}
                                                    orders={channel.orders || []}
                                                    duration={channel.duration}
                                                    onTap={() => handleRoomClick(null, channel.id)}
                                                    onLongPress={() => showRenameRoomModal(null, channel.id)}
                                                    compact={true}
                                                />
                                            </div>
                                        ))}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Tables Section */}
                    <div className="mb-6 bg-section-bg rounded-xl shadow-section overflow-hidden border border-gray-200">
                        <div className="px-3 py-3 border-b border-gray-200 flex items-center justify-between">
                            <div className="flex items-center">
                                <i className="ph ph-table text-red-500 text-xl mr-2"></i>
                                <h2 className="text-lg font-semibold text-gray-800">Dining Tables</h2>
                            </div>
                            <button
                                onClick={showAddTableModal}
                                className="px-2 py-1 bg-gradient-to-r from-white to-gray-50 border border-gray-200 text-red-500 rounded-lg hover:bg-red-50 transition-colors flex items-center gap-1.5 text-sm shadow-sm"
                            >
                                <i className="ph ph-plus"></i>
                                <span>Add Table</span>
                            </button>
                        </div>
                        <div className="p-3">
                            {isLoading ? (
                                <div className="text-center py-10">
                                    <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-red-500 mx-auto"></div>
                                    <p className="mt-3 text-gray-600">Loading tables...</p>
                                </div>
                            ) : error ? (
                                <div className="text-center py-10">
                                    <div className="rounded-full h-10 w-10 bg-red-100 flex items-center justify-center mx-auto">
                                        <i className="ph ph-x text-red-500 text-xl"></i>
                                    </div>
                                    <p className="mt-3 text-gray-600">{error}</p>
                                </div>
                            ) : tables.length === 0 ? (
                                <NoOrdersFound />
                            ) : (
                                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                                    {tables
                                        .filter(table => table.isTable)
                                        .map(table => (
                                            <div
                                                key={table.id}
                                                className="mb-2"
                                                onClick={() => handleRoomClick(table.id, null)}
                                                onContextMenu={(e) => {
                                                    e.preventDefault();
                                                    showRenameRoomModal(table.id, null);
                                                }}
                                            >
                                                <TableCard
                                                    title={table.title}
                                                    orders={table.orders || []}
                                                    duration={table.duration}
                                                    onTap={() => handleRoomClick(table.id, null)}
                                                    onLongPress={() => showRenameRoomModal(table.id, null)}
                                                    onRelease={releaseTable}
                                                    compact={true}
                                                />
                                            </div>
                                        ))}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Orders Section */}
                    <div className="mb-6 bg-section-bg rounded-xl shadow-section overflow-hidden border border-gray-200">
                        <div className="px-3 py-3 border-b border-gray-200 flex items-center">
                            <i className="ph ph-qr-code text-red-500 text-xl mr-2"></i>
                            <h2 className="text-lg font-semibold text-gray-800">Recent Orders</h2>
                        </div>

                        {/* Order Tabs */}
                        <div className="flex border-b border-gray-200">
                            <button
                                className={`flex-1 py-2 px-4 text-sm font-medium ${!showCompletedOrders ? 'text-red-500 border-b-2 border-red-500' : 'text-gray-500 hover:text-gray-700'}`}
                                onClick={() => setShowCompletedOrders(false)}
                            >
                                <i className={`ph ph-timer ${!showCompletedOrders ? 'text-red-500' : 'text-gray-400'} mr-1.5`}></i>
                                QR Orders
                            </button>
                            <button
                                className={`flex-1 py-2 px-4 text-sm font-medium ${showCompletedOrders ? 'text-red-500 border-b-2 border-red-500' : 'text-gray-500 hover:text-gray-700'}`}
                                onClick={() => setShowCompletedOrders(true)}
                            >
                                <i className={`ph ph-check-circle ${showCompletedOrders ? 'text-red-500' : 'text-gray-400'} mr-1.5`}></i>
                                Completed Orders
                            </button>
                        </div>

                        {/* Desktop Summary Row - Only for Active Orders tab */}
                        {!showCompletedOrders && (
                            <div className="hidden md:flex border-b border-gray-100 bg-gradient-to-r from-warm-bg to-white">
                                <div className="grid grid-cols-4 gap-4 p-4 w-full">
                                    <div className="flex items-center gap-2">
                                        <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-red-50 to-white flex items-center justify-center shadow-sm flex-shrink-0">
                                            <i className="ph ph-timer text-red-500 text-lg"></i>
                                        </div>
                                        <div>
                                            <div className="text-xs text-gray-500">Pending Orders</div>
                                            <div className="text-lg font-bold text-gray-800">{qrOrders.length}</div>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-green-50 to-white flex items-center justify-center shadow-sm flex-shrink-0">
                                            <i className="ph ph-check-circle text-green-500 text-lg"></i>
                                        </div>
                                        <div>
                                            <div className="text-xs text-gray-500">Kitchen Orders Today</div>
                                            <div className="text-lg font-bold text-gray-800">
                                                {(() => {
                                                    // Filter orders accepted today
                                                    const today = new Date();
                                                    today.setHours(0, 0, 0, 0);
                                                    const acceptedToday = orders.filter(order => {
                                                        // Check if order has 'KITCHEN' status
                                                        if (!order.status || !Array.isArray(order.status)) return false;

                                                        // Find the kitchen status entry
                                                        const kitchenStatus = order.status.find(
                                                            s => s.label && s.label.toUpperCase() === 'KITCHEN'
                                                        );

                                                        if (!kitchenStatus || !kitchenStatus.date) return false;

                                                        // Check if it was accepted today - ensure consistent date handling
                                                        const statusDate = kitchenStatus.date?.toDate ? 
                                                            kitchenStatus.date.toDate() : 
                                                            parseDate(kitchenStatus.date);
                                                        return statusDate && statusDate >= today;
                                                    });

                                                    return acceptedToday.length;
                                                })()}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-orange-50 to-white flex items-center justify-center shadow-sm flex-shrink-0">
                                            <i className="ph ph-clock-countdown text-orange-500 text-lg"></i>
                                        </div>
                                        <div>
                                            <div className="text-xs text-gray-500">Avg. Accept Time</div>
                                            <div className="text-lg font-bold text-gray-800">
                                                {(() => {
                                                    // Calculate average acceptance time for orders today
                                                    const today = new Date();
                                                    today.setHours(0, 0, 0, 0);

                                                    let totalAcceptTimeMinutes = 0;
                                                    let acceptedOrderCount = 0;

                                                    orders.forEach(order => {
                                                        if (!order.status || !Array.isArray(order.status)) return;

                                                        // Find the placed and kitchen status entries
                                                        const placedStatus = order.status.find(
                                                            s => s.label && s.label.toUpperCase() === 'PLACED'
                                                        );

                                                        const kitchenStatus = order.status.find(
                                                            s => s.label && s.label.toUpperCase() === 'KITCHEN'
                                                        );

                                                        if (!placedStatus || !kitchenStatus) return;

                                                        // Ensure proper date handling for both timestamps
                                                        const placedDate = placedStatus.date?.toDate ? 
                                                            placedStatus.date.toDate() : 
                                                            parseDate(placedStatus.date);
                                                            
                                                        const kitchenDate = kitchenStatus.date?.toDate ? 
                                                            kitchenStatus.date.toDate() : 
                                                            parseDate(kitchenStatus.date);

                                                        if (!placedDate || !kitchenDate) return;

                                                        // Only consider orders accepted today
                                                        if (kitchenDate < today) return;

                                                        // Calculate time difference in minutes
                                                        const acceptTimeMinutes = (kitchenDate - placedDate) / (1000 * 60);

                                                        // Only consider valid times (greater than 0 and less than 1 day)
                                                        if (acceptTimeMinutes > 0 && acceptTimeMinutes < 1440) {
                                                            totalAcceptTimeMinutes += acceptTimeMinutes;
                                                            acceptedOrderCount++;
                                                        }
                                                    });

                                                    if (acceptedOrderCount === 0) return "N/A";

                                                    const avgAcceptTime = Math.round(totalAcceptTimeMinutes / acceptedOrderCount);
                                                    return `${avgAcceptTime} min`;
                                                })()}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-blue-50 to-white flex items-center justify-center shadow-sm flex-shrink-0">
                                            <i className="ph ph-money text-blue-500 text-lg"></i>
                                        </div>
                                        <div>
                                            <div className="text-xs text-gray-500">Avg. Order Value</div>
                                            <div className="text-lg font-bold text-gray-800">
                                                {(() => {
                                                    // Calculate average order value for QR orders
                                                    if (qrOrders.length === 0) return "${UserSession?.getCurrency()}0";

                                                    const totalValue = qrOrders.reduce((sum, order) => {
                                                        const itemsTotal = order.items?.reduce((total, item) => {
                                                            return total + ((item.price || 0) * (item.quantity || item.qnt || 1));
                                                        }, 0) || 0;

                                                        return sum + itemsTotal;
                                                    }, 0);

                                                    const avgValue = Math.round(totalValue / qrOrders.length);
                                                    return `${UserSession?.getCurrency()}${avgValue}`;
                                                })()}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Date Filter - Only for Completed Orders tab */}
                        {showCompletedOrders && (
                            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gradient-to-r from-warm-bg to-white">
                                <div className="relative">
                                    <select
                                        value={dateFilter}
                                        onChange={(e) => setDateFilter(e.target.value)}
                                        className="appearance-none bg-gradient-to-r from-white to-gray-50 border border-gray-200 text-gray-700 py-1.5 px-4 pr-8 rounded-lg leading-tight focus:outline-none focus:border-red-500 text-sm"
                                    >
                                        <option value="today">Today</option>
                                        <option value="yesterday">Yesterday</option>
                                        <option value="7days">Last 7 Days</option>
                                        <option value="30days">Last 30 Days</option>
                                        <option value="custom">Custom Range</option>
                                    </select>
                                    <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-700">
                                        <i className="ph ph-caret-down"></i>
                                    </div>
                                </div>
                            </div>
                        )}

                        <div className="p-4" ref={qrOrdersScrollRef} onScroll={handleScroll}>
                            {/* Active Orders Tab Content */}
                            {!showCompletedOrders && (
                                <>
                                    {loadingQrOrders ? (
                                        <div className="text-center py-10">
                                            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-red-500 mx-auto"></div>
                                            <p className="mt-3 text-gray-600">Loading QR orders...</p>
                                        </div>
                                    ) : errorQrOrders ? (
                                        <div className="bg-red-50 text-red-600 p-4 rounded-lg mb-4">
                                            <p>{errorQrOrders}</p>
                                        </div>
                                    ) : qrOrders.length === 0 ? (
                                        <div className="text-center py-10">
                                            <div className="w-16 h-16 bg-gradient-to-br from-red-100 to-red-50 rounded-full flex items-center justify-center mx-auto mb-4">
                                                <i className="ph ph-qr-code text-2xl text-red-500"></i>
                                            </div>
                                            <h3 className="text-lg font-medium text-gray-700 mb-1">No QR Orders Found</h3>
                                            <p className="text-gray-500">QR orders from your customers will appear here</p>
                                        </div>
                                    ) : (
                                        <div>
                                            <div className="overflow-x-auto md:overflow-visible">
                                                <div className="space-y-3 min-w-[100%] md:min-w-0">
                                                    {qrOrders.map(order => (
                                                        <OrderGroupTile
                                                            key={order.id}
                                                            order={order}
                                                            onAccept={() => handleAcceptOrder(order.id)}
                                                            onReject={() => handleRejectOrder(order.id)}
                                                            onPrintBill={() => handlePrintBill(order.id)}
                                                        />
                                                    ))}

                                                    {isLoadingMore && (
                                                        <div className="text-center py-4">
                                                            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-red-500 mx-auto"></div>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="md:hidden text-center text-xs text-gray-400 mt-3 flex items-center justify-center">
                                                <i className="ph ph-arrows-horizontal mr-1 text-gray-300"></i>
                                                <span>Swipe horizontally on orders if needed</span>
                                            </div>
                                        </div>
                                    )}
                                </>
                            )}

                            {/* Completed Orders Tab Content */}
                            {showCompletedOrders && (
                                <>
                                    {loadingCompletedOrders ? (
                                        <div className="text-center py-10">
                                            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-red-500 mx-auto"></div>
                                            <p className="mt-3 text-gray-600">Loading completed orders...</p>
                                        </div>
                                    ) : errorCompletedOrders ? (
                                        <div className="bg-red-50 text-red-600 p-4 rounded-lg mb-4">
                                            <p>{errorCompletedOrders}</p>
                                        </div>
                                    ) : orders.length === 0 ? (
                                        <div className="text-center py-10">
                                            <div className="w-16 h-16 bg-gradient-to-br from-red-100 to-red-50 rounded-full flex items-center justify-center mx-auto mb-4">
                                                <i className="ph ph-check-circle text-2xl text-red-500"></i>
                                            </div>
                                            <h3 className="text-lg font-medium text-gray-700 mb-1">No Completed Orders</h3>
                                            <p className="text-gray-500">Completed orders will appear here</p>
                                        </div>
                                    ) : (
                                        <div className="space-y-3">
                                            {orders
                                                .filter(order => order.currentStatus?.label === "COMPLETED" || order.paid === true)
                                                .map(order => (
                                                    <OrderGroupTile
                                                        key={order.id}
                                                        order={order}
                                                        onPrintBill={() => handlePrintBill(order.id)}
                                                    />
                                                ))
                                            }
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    </div>
                </>
            )}

            {/* Settings View */}
            {activeView === 'settings' && (
                <div className="space-y-6">
                    {/* Store Settings */}
                    <div className="bg-white rounded-xl shadow-sm overflow-hidden border border-gray-200">
                        <div className="px-4 py-3 border-b border-gray-100 flex items-center">
                            <i className="ph ph-storefront text-red-500 text-xl mr-2"></i>
                            <h2 className="text-lg font-semibold text-gray-800">Store Settings</h2>
                        </div>
                        <div className="p-4 space-y-4">
                            {!seller ? (
                                <div className="text-center py-10">
                                    <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-red-500 mx-auto"></div>
                                    <p className="mt-3 text-gray-600">Loading store details...</p>
                                </div>
                            ) : (
                                <>
                                    <div className="flex flex-col sm:flex-row sm:items-center gap-4 pb-4 border-b border-gray-100">
                                        <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-red-50 to-white flex items-center justify-center border border-gray-200 shadow-sm">
                                            {seller.logo ? (
                                                <img src={seller.logo} alt={seller.name} className="w-10 h-10 object-contain" />
                                            ) : (
                                                <i className="ph ph-storefront text-red-500 text-2xl"></i>
                                            )}
                                        </div>
                                        <div className="flex-1">
                                            <h3 className="text-lg font-semibold text-gray-800">{seller.businessName || 'Your Store'}</h3>
                                            <p className="text-gray-500">{seller.phone || 'Retail Store'}</p>
                                        </div>
                                        <button
                                            onClick={() => {
                                                ModalManagereCenterModal({
                                                    id: 'edit-profile-modal',
                                                    title: "Edit Store Profile",
                                                    content: `
                                                    <div class="p-4">
                                                        <div id="profile-error-container" class="mb-4 hidden p-3 bg-red-50 text-red-700 rounded-md"></div>
                                                        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                                                            <div>
                                                                <label class="block text-sm font-medium text-gray-700 mb-1">
                                                                    Business Name
                                                                </label>
                                                                <input
                                                                    type="text"
                                                                    id="business-name-input"
                                                                    class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500"
                                                                    value="${seller.businessName || ''}"
                                                                    required
                                                                />
                                                            </div>
                                                            <div>
                                                                <label class="block text-sm font-medium text-gray-700 mb-1">
                                                                    Phone
                                                                </label>
                                                                <input
                                                                    type="tel"
                                                                    id="phone-input"
                                                                    class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500"
                                                                    value="${seller.phone || ''}"
                                                                />
                                                            </div>
                                                            <div class="md:col-span-2">
                                                                <label class="block text-sm font-medium text-gray-700 mb-1">
                                                                    Address
                                                                </label>
                                                                <textarea
                                                                    id="address-input"
                                                                    rows="3"
                                                                    class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500"
                                                                >${seller.address || ''}</textarea>
                                                            </div>
                                                            <div>
                                                                <label class="block text-sm font-medium text-gray-700 mb-1">
                                                                    GST Number
                                                                </label>
                                                                <input
                                                                    type="text"
                                                                    id="gst-input"
                                                                    class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500"
                                                                    value="${seller.gstNo || ''}"
                                                                />
                                                            </div>
                                                            <div>
                                                                <label class="block text-sm font-medium text-gray-700 mb-1">
                                                                    UPI ID
                                                                </label>
                                                                <input
                                                                    type="text"
                                                                    id="upi-input"
                                                                    class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500"
                                                                    value="${seller.upiId || ''}"
                                                                />
                                                            </div>
                                                            <div>
                                                                <label class="block text-sm font-medium text-gray-700 mb-1">
                                                                    Currency
                                                                </label>
                                                                <select
                                                                    id="currency-input"
                                                                    class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500"
                                                                >
                                                                    ${CurrencyData?.currencies.map(currency =>
                                                        `<option value="${currency.code}" ${(seller.currencyCode || 'INR') === currency.code ? 'selected' : ''}>
                                                                            ${currency.name} (${currency.symbol})
                                                                        </option>`
                                                    ).join('')}
                                                                </select>
                                                            </div>
                                                            <div>
                                                                <label class="flex items-center">
                                                                    <input
                                                                        type="checkbox"
                                                                        id="kot-enabled-input"
                                                                        class="w-5 h-5 text-red-600 rounded focus:ring-red-500"
                                                                        ${seller.kotEnabled !== false ? 'checked' : ''}
                                                                    />
                                                                    <span class="ml-2 text-gray-700">Enable KOT (Kitchen Order Ticket)</span>
                                                                </label>
                                                            </div>
                                                        </div>
                                                    </div>
                                                    `,
                                                    actions: `
                                                    <div class="flex justify-end p-4 space-x-3">
                                                        <button id="cancel-profile-btn" class="px-4 py-2 border rounded-md hover:bg-gray-50">Cancel</button>
                                                        <button id="save-profile-btn" class="px-4 py-2 bg-red-500 text-white rounded-md hover:bg-red-600">Save Changes</button>
                                                    </div>
                                                    `,
                                                    size: 'lg',
                                                    onShown: (modalControl) => {
                                                        const businessNameInput = document.getElementById('business-name-input');
                                                        const phoneInput = document.getElementById('phone-input');
                                                        const addressInput = document.getElementById('address-input');
                                                        const gstInput = document.getElementById('gst-input');
                                                        const upiInput = document.getElementById('upi-input');
                                                        const kotEnabledInput = document.getElementById('kot-enabled-input');
                                                        const errorContainer = document.getElementById('profile-error-container');
                                                        const cancelButton = document.getElementById('cancel-profile-btn');
                                                        const saveButton = document.getElementById('save-profile-btn');

                                                        // Basic validation
                                                        const validateForm = () => {
                                                            if (!businessNameInput.value.trim()) {
                                                                errorContainer.textContent = 'Business name is required';
                                                                errorContainer.classList.remove('hidden');
                                                                return false;
                                                            }

                                                            if (gstInput.value.trim() && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(gstInput.value.trim())) {
                                                                errorContainer.textContent = 'Please enter a valid GST number';
                                                                errorContainer.classList.remove('hidden');
                                                                return false;
                                                            }

                                                            return true;
                                                        };

                                                        // Event handlers
                                                        cancelButton.addEventListener('click', () => {
                                                            modalControl.close();
                                                        });

                                                        saveButton.addEventListener('click', async () => {
                                                            if (!validateForm()) return;

                                                            try {
                                                                // Prepare update data
                                                                const updateData = {
                                                                    businessName: businessNameInput.value.trim(),
                                                                    phone: phoneInput.value.trim(),
                                                                    address: addressInput.value.trim(),
                                                                    gstNo: gstInput.value.trim(),
                                                                    upiId: upiInput.value.trim(),
                                                                    kotEnabled: kotEnabledInput.checked,
                                                                    currencyCode: document.getElementById('currency-input').value
                                                                };

                                                                // Update Firestore
                                                                await sdk.profile.update(updateData);

                                                                // Update UserSession with new currency code
                                                                if (UserSession) {
                                                                    UserSession.setCurrencyCode(updateData.currencyCode);
                                                                }

                                                                ModalManagerast('Store profile updated successfully');
                                                                modalControl.close();

                                                                // Refresh the page to reflect changes
                                                                setTimeout(() => {
                                                                    window.location.reload();
                                                                }, 1000);
                                                            } catch (error) {
                                                                console.error('Error updating store profile:', error);
                                                                errorContainer.textContent = 'Failed to update profile. Please try again.';
                                                                errorContainer.classList.remove('hidden');
                                                            }
                                                        });
                                                    }
                                                });
                                            }}
                                            className="px-3 py-1.5 bg-gradient-to-r from-white to-gray-50 border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors flex items-center gap-1.5 text-sm shadow-sm self-start sm:self-center"
                                        >
                                            <i className="ph ph-pencil"></i>
                                            <span>Edit</span>
                                        </button>
                                    </div>

                                    <div className="space-y-0">
                                        {/* Receipt Template */}
                                        <div
                                            className="flex flex-col sm:flex-row sm:items-center justify-between py-4 border-b border-gray-100 cursor-pointer hover:bg-gray-50 px-4 rounded-lg transition-colors"
                                            onClick={() => {
                                                // Open Receipt Template management
                                                handlePrintTemplateManagement();
                                            }}>
                                            <div className="flex items-center">
                                                <div className="w-12 h-12 bg-red-50 rounded-lg mr-4 flex-shrink-0 flex items-center justify-center">
                                                    <i className="ph ph-file-text text-red-500 text-xl"></i>
                                                </div>
                                                <div>
                                                    <h4 className="font-medium text-gray-800">Receipt Template</h4>
                                                    <p className="text-sm text-gray-500">Manage KOT & Bill template</p>
                                                </div>
                                            </div>
                                            <button className="mt-2 sm:mt-0 text-gray-400 self-start">
                                                <i className="ph ph-caret-right text-lg"></i>
                                            </button>
                                        </div>

                                        {/* Printer Management */}
                                        <div
                                            className="flex flex-col sm:flex-row sm:items-center justify-between py-4 border-b border-gray-100 cursor-pointer hover:bg-gray-50 px-4 rounded-lg transition-colors"
                                            onClick={() => {
                                                // Open Printer Management
                                                handlePrinterManagement();
                                            }}>
                                            <div className="flex items-center">
                                                <div className="w-12 h-12 bg-red-50 rounded-lg mr-4 flex-shrink-0 flex items-center justify-center">
                                                    <i className="ph ph-printer text-red-500 text-xl"></i>
                                                </div>
                                                <div>
                                                    <h4 className="font-medium text-gray-800">Printer Management</h4>
                                                    <p className="text-sm text-gray-500">Configure printers for different channels</p>
                                                </div>
                                            </div>
                                            <button className="mt-2 sm:mt-0 text-gray-400 self-start">
                                                <i className="ph ph-caret-right text-lg"></i>
                                            </button>
                                        </div>

                                        {/* Bulk Tax Update */}
                                        <div
                                            className="flex flex-col sm:flex-row sm:items-center justify-between py-4 border-b border-gray-100 cursor-pointer hover:bg-gray-50 px-4 rounded-lg transition-colors"
                                            onClick={() => {
                                                // Open Bulk Tax Update management
                                                handleBulkTaxUpdate();
                                            }}>
                                            <div className="flex items-center">
                                                <div className="w-12 h-12 bg-red-50 rounded-lg mr-4 flex-shrink-0 flex items-center justify-center">
                                                    <i className="ph ph-currency-dollar text-red-500 text-xl"></i>
                                                </div>
                                                <div>
                                                    <h4 className="font-medium text-gray-800">Bulk Tax Update</h4>
                                                    <p className="text-sm text-gray-500">Update tax for all products</p>
                                                </div>
                                            </div>
                                            <button className="mt-2 sm:mt-0 text-gray-400 self-start">
                                                <i className="ph ph-caret-right text-lg"></i>
                                            </button>
                                        </div>

                                        {/* Store Hours */}
                                        <div
                                            className="flex flex-col sm:flex-row sm:items-center justify-between py-4 border-b border-gray-100 cursor-pointer hover:bg-gray-50 px-4 rounded-lg transition-colors"
                                            onClick={() => {
                                                // Open Store Hours management
                                                ModalManagereCenterModal({
                                                    id: 'store-hours-modal',
                                                    title: "Store Hours",
                                                    content: `<div class="p-4">
                                                        <div class="space-y-4">
                                                            <div>
                                                                <h3 class="font-medium mb-2">Business Days</h3>
                                                                <div class="flex flex-wrap gap-2">
                                                                    <button class="px-3 py-1 bg-red-500 text-white rounded-md">Mon</button>
                                                                    <button class="px-3 py-1 bg-red-500 text-white rounded-md">Tue</button>
                                                                    <button class="px-3 py-1 bg-red-500 text-white rounded-md">Wed</button>
                                                                    <button class="px-3 py-1 bg-red-500 text-white rounded-md">Thu</button>
                                                                    <button class="px-3 py-1 bg-red-500 text-white rounded-md">Fri</button>
                                                                    <button class="px-3 py-1 border border-gray-300 text-gray-600 rounded-md">Sat</button>
                                                                    <button class="px-3 py-1 border border-gray-300 text-gray-600 rounded-md">Sun</button>
                                                                </div>
                                                            </div>
                                                            <div>
                                                                <h3 class="font-medium mb-2">Opening Hours</h3>
                                                                <div class="grid grid-cols-2 gap-4">
                                                                    <div>
                                                                        <label class="block text-sm text-gray-600 mb-1">Opening Time</label>
                                                                        <input type="time" class="w-full px-3 py-2 border rounded-md" value="09:00">
                                                                    </div>
                                                                    <div>
                                                                        <label class="block text-sm text-gray-600 mb-1">Closing Time</label>
                                                                        <input type="time" class="w-full px-3 py-2 border rounded-md" value="21:00">
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>`,
                                                    actions: `
                                                        <div class="flex justify-end p-4">
                                                            <button id="save-hours-btn" class="px-4 py-2 bg-red-500 text-white rounded-md">Save</button>
                                                        </div>
                                                    `,
                                                    size: 'md'
                                                });
                                            }}>
                                            <div className="flex items-center">
                                                <div className="w-12 h-12 bg-red-50 rounded-lg mr-4 flex-shrink-0 flex items-center justify-center">
                                                    <i className="ph ph-clock text-red-500 text-xl"></i>
                                                </div>
                                                <div>
                                                    <h4 className="font-medium text-gray-800">Store Hours</h4>
                                                    <p className="text-sm text-gray-500">Set your regular business hours</p>
                                                </div>
                                            </div>
                                            <button className="mt-2 sm:mt-0 text-gray-400 self-start">
                                                <i className="ph ph-caret-right text-lg"></i>
                                            </button>
                                        </div>

                                        {/* Payment Methods */}
                                        <div
                                            className="flex flex-col sm:flex-row sm:items-center justify-between py-4 border-b border-gray-100 cursor-pointer hover:bg-gray-50 px-4 rounded-lg transition-colors"
                                            onClick={() => {
                                                // Open Payment Methods management
                                                ModalManagereCenterModal({
                                                    id: 'payment-methods-modal',
                                                    title: "Payment Methods",
                                                    content: `<div class="p-4">
                                                        <div class="space-y-4">
                                                            <div class="flex items-center justify-between p-3 border rounded-md">
                                                                <div class="flex items-center">
                                                                    <i class="ph ph-money text-red-500 text-xl mr-3"></i>
                                                                    <span>Cash</span>
                                                                </div>
                                                                <label class="relative inline-flex items-center cursor-pointer">
                                                                    <input type="checkbox" checked class="sr-only peer">
                                                                    <div class="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-red-500"></div>
                                                                </label>
                                                            </div>
                                                            <div class="flex items-center justify-between p-3 border rounded-md">
                                                                <div class="flex items-center">
                                                                    <i class="ph ph-credit-card text-red-500 text-xl mr-3"></i>
                                                                    <span>Card Payment</span>
                                                                </div>
                                                                <label class="relative inline-flex items-center cursor-pointer">
                                                                    <input type="checkbox" checked class="sr-only peer">
                                                                    <div class="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-red-500"></div>
                                                                </label>
                                                            </div>
                                                            <div class="flex items-center justify-between p-3 border rounded-md">
                                                                <div class="flex items-center">
                                                                    <i class="ph ph-qr-code text-red-500 text-xl mr-3"></i>
                                                                    <span>UPI</span>
                                                                </div>
                                                                <label class="relative inline-flex items-center cursor-pointer">
                                                                    <input type="checkbox" checked class="sr-only peer">
                                                                    <div class="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-red-500"></div>
                                                                </label>
                                                            </div>
                                                        </div>
                                                    </div>`,
                                                    actions: `
                                                        <div class="flex justify-end p-4">
                                                            <button id="save-payment-methods-btn" class="px-4 py-2 bg-red-500 text-white rounded-md">Save</button>
                                                        </div>
                                                    `,
                                                    size: 'md'
                                                });
                                            }}>
                                            <div className="flex items-center">
                                                <div className="w-12 h-12 bg-red-50 rounded-lg mr-4 flex-shrink-0 flex items-center justify-center">
                                                    <i className="ph ph-credit-card text-red-500 text-xl"></i>
                                                </div>
                                                <div>
                                                    <h4 className="font-medium text-gray-800">Payment Methods</h4>
                                                    <p className="text-sm text-gray-500">Manage available payment options</p>
                                                </div>
                                            </div>
                                            <button className="mt-2 sm:mt-0 text-gray-400 self-start">
                                                <i className="ph ph-caret-right text-lg"></i>
                                            </button>
                                        </div>

                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Modals */}
            <AddTableModal
                isOpen={isAddTableModalOpen}
                onClose={() => setIsAddTableModalOpen(false)}
                seller={seller}
            />

            <RenameRoomModal
                isOpen={isRenameRoomModalOpen}
                onClose={() => setIsRenameRoomModalOpen(false)}
                tableId={selectedTableId}
                variant={selectedVariant}
                seller={seller}
            />

            <OrderRoom
                isOpen={isOrderRoomOpen}
                onClose={() => setIsOrderRoomOpen(false)}
                tableId={selectedRoomTableId}
                variant={selectedRoomVariant}
                orderStatus="KITCHEN"
                seller={seller}
            />
        </div>
    );
} 