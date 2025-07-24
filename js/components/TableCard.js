import { useState } from 'react';
import { prettyTime, getOrderSource } from '../utils.js';
import { ModalManager } from './ModalManager.js';
import { BluetoothPrinting } from '../utils/BluetoothPrinting.js';
import { UserSession } from '../utils/UserSession.js';

// Table Card Component
export function TableCard({ title, orders, duration, status, onTap, onLongPress, compact = false, onRelease }) {
    // Calculate color based on last placed date (similar to getColor in Flutter)
    const getColor = (duration) => {
        if (!duration) return {
            border: 'border-gray-200',
            gradient: 'bg-gradient-to-br from-card-bg to-white'
        };

        const minutes = duration.minutes || 0;

        if (minutes < 15) return {
            border: 'border-gray-200',
            gradient: 'bg-gradient-to-br from-green-50 to-white'
        };
        if (minutes < 30) return {
            border: 'border-gray-200',
            gradient: 'bg-gradient-to-br from-orange-50 to-white'
        };
        return {
            border: 'border-gray-200',
            gradient: 'bg-gradient-to-br from-red-50 to-white'
        };
    };

    // Get message based on last placed date (similar to getMsg in Flutter)
    const getMessage = (duration) => {
        if (!duration) return 'No orders';

        const minutes = duration.minutes || 0;

        if (minutes < 3) return 'Just now';
        return `${duration.display}`;
    };

    const colorStyle = getColor(duration);
    const message = getMessage(duration);
    const hasOrders = orders && orders.length > 0;

    // Calculate order status text
    const orderText = hasOrders
        ? `${orders.length} ${orders.length === 1 ? 'order' : 'orders'}`
        : 'No orders';

    // Render compact version for mobile
    if (compact) {
        return (
            <div
                className={`${colorStyle.gradient} rounded-xl p-2 md:p-3 h-full flex flex-col cursor-pointer hover:shadow-md transition-all border ${colorStyle.border} shadow-section`}
                onClick={onTap}
                onContextMenu={(e) => {
                    e.preventDefault();
                    onLongPress && onLongPress();
                }}
                data-table-id={title}
            >
                <div className="flex items-center justify-between mb-1.5 md:mb-2">
                    <h3 className="text-xs md:text-sm font-bold line-clamp-1 leading-tight max-w-[70%]">{title}</h3>
                    <div className="w-6 h-6 md:w-7 md:h-7 rounded-lg bg-gradient-to-br from-white to-white/80 flex items-center justify-center shadow-sm flex-shrink-0">
                        <i className="ph ph-table text-red-500 text-xs md:text-sm"></i>
                    </div>
                </div>

                <div className="mt-auto">
                    <div className={`text-2xs md:text-xs font-medium px-1.5 py-0.5 md:px-2 md:py-1 rounded-full mb-0.5 md:mb-1 inline-flex items-center ${hasOrders ? 'bg-gradient-to-r from-red-100 to-red-50 text-red-600 order-indicator' : 'bg-gradient-to-r from-gray-100 to-gray-50 text-gray-500'}`}>
                        {hasOrders ? (
                            <i className="ph ph-shopping-bag text-2xs md:text-xs mr-0.5 md:mr-1"></i>
                        ) : (
                            <i className="ph ph-tray-empty text-2xs md:text-xs mr-0.5 md:mr-1"></i>
                        )}
                        {orderText}
                    </div>

                    {duration && hasOrders && (
                        <div className="text-2xs md:text-xs bg-gradient-to-r from-gray-100 to-gray-50 px-1.5 md:px-2 py-0.5 md:py-1 rounded-full inline-flex items-center">
                            <i className="ph ph-clock text-red-500 text-2xs md:text-xs mr-0.5 md:mr-1"></i>
                            {message}
                        </div>
                    )}
                </div>
                
                {onRelease && (hasOrders || true) && (
                    <div className="mt-2 flex justify-end">
                        <button 
                            onClick={(e) => { 
                                e.stopPropagation(); 
                                e.preventDefault();
                                onRelease(title, title); 
                            }}
                            className="text-2xs md:text-xs text-gray-500 hover:text-blue-500 bg-white rounded-full w-5 h-5 md:w-6 md:h-6 flex items-center justify-center shadow-sm"
                            title="Release table"
                        >
                            <i className="ph ph-key"></i>
                        </button>
                    </div>
                )}
            </div>
        );
    }

    // Render standard version
    return (
        <div
            className={`${colorStyle.gradient} rounded-xl p-4 h-full flex flex-col cursor-pointer hover:shadow-md transition-all border ${colorStyle.border} shadow-section`}
            onClick={onTap}
            onContextMenu={(e) => {
                e.preventDefault();
                onLongPress && onLongPress();
            }}
            data-table-id={title}
        >
            <div className="flex items-center justify-between mb-3">
                <h3 className="text-lg font-bold truncate max-w-[70%]">{title}</h3>
                <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-white to-white/80 flex items-center justify-center shadow-sm">
                    <i className="ph ph-table text-red-500 text-lg"></i>
                </div>
            </div>

            <div className="mt-auto">
                <div className={`text-sm font-medium px-3 py-1.5 rounded-full mb-2 inline-flex items-center ${hasOrders ? 'bg-gradient-to-r from-red-100 to-red-50 text-red-600 order-indicator' : 'bg-gradient-to-r from-gray-100 to-gray-50 text-gray-500'}`}>
                    {hasOrders ? (
                        <i className="ph ph-shopping-bag text-xs mr-1.5"></i>
                    ) : (
                        <i className="ph ph-tray-empty text-xs mr-1.5"></i>
                    )}
                    {orderText}
                </div>

                {duration && hasOrders && (
                    <div className="text-xs bg-gradient-to-r from-gray-100 to-gray-50 px-2 py-1 rounded-full inline-flex items-center">
                        <i className="ph ph-clock text-red-500 text-xs mr-1"></i>
                        {message}
                    </div>
                )}
            </div>
            
            {onRelease && (hasOrders || true) && (
                <div className="mt-3 flex justify-end">
                    <button 
                        onClick={(e) => { 
                            e.stopPropagation(); 
                            e.preventDefault();
                            onRelease(title, title); 
                        }}
                        className="text-xs text-gray-500 hover:text-blue-500 bg-white rounded-full w-7 h-7 flex items-center justify-center shadow-sm"
                        title="Release table"
                    >
                        <i className="ph ph-key"></i>
                    </button>
                </div>
            )}
        </div>
    );
}

// Order Thumb Component
export function OrderThumb({ order }) {
    return (
        <div className="p-2 pl-4 pr-4">
            <div className="bg-gradient-to-br from-warm-bg to-white h-[150px] w-[150px] relative rounded-xl shadow-sm overflow-hidden border border-gray-100">
                <div className="absolute inset-0 overflow-hidden">
                    {order.items && order.items.length > 0 && (
                        <img
                            src={order.items[0].thumb || 'https://via.placeholder.com/150'}
                            alt={order.items[0].title || 'Order item'}
                            className="w-full h-full object-cover"
                            onError={(e) => {
                                e.target.onerror = null;
                                e.target.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 24 24" fill="none" stroke="%23ccc" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>';
                            }}
                        />
                    )}
                    <div className="absolute inset-2 bg-gradient-to-br from-white to-white/80 rounded-full flex items-center justify-center shadow-sm">
                        <div className="text-center">
                            <div className="text-3xl font-bold leading-none text-red-500">
                                {order.items ? order.items.length : 0}
                            </div>
                            <div className="text-sm leading-none text-gray-600">items</div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

// Order Group Tile Component
export function OrderGroupTile({ order, onAccept, onReject, onPrintBill }) {
    const [isExpanded, setIsExpanded] = useState(false);

    // Calculate time ago
    const orderDate = order.date instanceof Date ? order.date : new Date(order.date?.seconds ? order.date.seconds * 1000 : order.date);
    const timeAgo = prettyTime(orderDate);

    // Calculate total amount and items
    const totalAmount = order.items?.reduce((sum, item) => sum + (item.price || 0) * (item.quantity || item.qnt || 1), 0) || 0;
    const totalItems = order.items?.reduce((sum, item) => sum + (item.quantity || item.qnt || 1), 0) || 0;

    // Order source (price variant or table) - using the same logic as Flutter
    const orderSource = getOrderSource(order);

    // Determine if this is a new order that can be accepted/rejected
    const isNewOrder = order.currentStatus?.label === "PLACED";
    const isCompletedOrder = order.currentStatus?.label === "COMPLETED" || order.paid === true;

    const handleOrderClick = () => {
        if (ModalManager && typeof ModalManager.createSideDrawerModal === 'function') {
            const modal = ModalManager.createSideDrawerModal({
                id: `order-details-modal-${order.id}`,
                title: 'Order Details',
                content: `<div class="p-4 text-center">
                            <div class="animate-spin inline-block w-8 h-8 border-4 border-red-500 border-t-transparent rounded-full"></div>
                            <p class="mt-2">Loading order details...</p>
                         </div>`,
                onShown: (modalControl) => {
                    // Add functions to modalControl
                    modalControl.acceptOrder = () => {
                        onAccept && onAccept(order.id);
                    };

                    modalControl.rejectOrder = () => {
                        onReject && onReject(order.id);
                    };

                    // Add print functions to modalControl
                    modalControl.printBill = async (orderId) => {
                        try {
                            if (BluetoothPrinting) {
                                await BluetoothPrinting.printBill(orderId || order.id);
                                // Show success message
                                if (ModalManager && typeof ModalManager.showToast === 'function') {
                                    ModalManager.showToast("Bill printed successfully", { type: "success" });
                                } else {
                                    alert("Bill printed successfully");
                                }
                            } else {
                                onPrintBill && onPrintBill(orderId || order.id);
                            }
                            modalControl.close();
                        } catch (error) {
                            console.error("Error printing bill:", error);
                            // Show error message
                            if (ModalManager && typeof ModalManager.showToast === 'function') {
                                ModalManager.showToast("Failed to print bill: " + error.message, { type: "error" });
                            } else {
                                alert("Failed to print bill: " + error.message);
                            }
                        }
                    };

                    modalControl.printKOT = async (orderId) => {
                        try {
                            if (BluetoothPrinting) {
                                await BluetoothPrinting.printKOT(orderId || order.id);
                                // Show success message
                                if (ModalManager && typeof ModalManager.showToast === 'function') {
                                    ModalManager.showToast("Kitchen order printed successfully", { type: "success" });
                                } else {
                                    alert("Kitchen order printed successfully");
                                }
                            } else {
                                onPrintBill && onPrintBill(orderId || order.id);
                            }
                            modalControl.close();
                        } catch (error) {
                            console.error("Error printing kitchen order:", error);
                            // Show error message
                            if (ModalManager && typeof ModalManager.showToast === 'function') {
                                ModalManager.showToast("Failed to print kitchen order: " + error.message, { type: "error" });
                            } else {
                                alert("Failed to print kitchen order: " + error.message);
                            }
                        }
                    };

                    // Create a temporary div to render the React component
                    const tempDiv = document.createElement('div');
                    ReactDOM.render(
                        createElement(OrderDetailsContent, {
                            order: order,
                            modalControl: modalControl,
                            onAccept,
                            onReject
                        }),
                        tempDiv,
                        () => {
                            modalControl.setContent(tempDiv.innerHTML);
                        }
                    );
                }
            });
        } else {
            // Fallback to original implementation
            const modalContainer = document.createElement('div');
            modalContainer.id = 'order-details-modal';
            document.body.appendChild(modalContainer);

            try {
                ReactDOM.render(
                    createElement(OrderDetailsModal, {
                        order: order,
                        onClose: () => {
                            ReactDOM.unmountComponentAtNode(modalContainer);
                            document.body.removeChild(modalContainer);
                        },
                        onAccept,
                        onReject,
                        onPrintBill
                    }),
                    modalContainer
                );
            } catch (error) {
                console.error('Error rendering order details modal:', error);
            }
        }
    };

    // Get status color
    const getStatusColor = (status) => {
        if (!status) return 'bg-gray-50 text-gray-600 border-gray-200';

        const label = status.label?.toUpperCase();

        if (label === 'PLACED') return 'bg-red-50 text-red-600 border-red-100';
        if (label === 'KITCHEN') return 'bg-orange-50 text-orange-600 border-orange-100';
        if (label === 'COMPLETED') return 'bg-green-50 text-green-600 border-green-100';
        if (label === 'CANCELLED') return 'bg-red-50 text-red-600 border-red-100';

        return 'bg-gray-50 text-gray-600 border-gray-200';
    };

    // Get status badge color
    const statusColor = getStatusColor(order.currentStatus);

    return (
        <div className="my-2">
            <div
                className="bg-white rounded-xl shadow-sm overflow-hidden hover:shadow-md transition-all border border-gray-200"
            >
                {/* Order card content - clickable area */}
                <div
                    className="p-3 md:p-4 cursor-pointer"
                    onClick={handleOrderClick}
                >
                    <div className="flex items-center justify-between mb-2.5">
                        <div className="flex items-center gap-2.5">
                            <div className="w-9 h-9 bg-red-50 rounded-lg flex items-center justify-center shadow-sm flex-shrink-0">
                                <i className="ph ph-shopping-bag text-red-500 text-base"></i>
                            </div>
                            <div>
                                <h3 className="font-medium text-gray-900 line-clamp-1 max-w-[120px] md:max-w-[200px] text-sm md:text-base">
                                    {order.custName || "Guest Customer"}
                                </h3>
                                {/* Customer phone number below name */}
                                <p className="text-xs text-gray-500">
                                    {order.custPhone || order.customer?.phone || "No phone"}
                                </p>
                                <p className="text-xs text-gray-400">
                                    {timeAgo}
                                </p>
                            </div>
                        </div>
                        <div className="text-right">
                            <div className="text-sm md:text-base font-semibold text-red-600">{UserSession?.getCurrency()}{totalAmount}</div>
                            <div className="text-xs text-gray-500">#{order.id?.slice(-6)}</div>
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-1.5 mt-2">
                        <div className="flex items-center gap-1.5 flex-wrap">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium flex items-center border ${statusColor}`}>
                                {order.currentStatus?.label === "PLACED" && <i className="ph ph-hourglass text-red-600 mr-1"></i>}
                                {order.currentStatus?.label === "KITCHEN" && <i className="ph ph-cooking-pot text-orange-600 mr-1"></i>}
                                {order.currentStatus?.label === "COMPLETED" && <i className="ph ph-check-circle text-green-600 mr-1"></i>}
                                {order.currentStatus?.label?.toUpperCase() || "PLACED"}
                            </span>
                            <span className="px-2 py-0.5 bg-red-50 text-red-600 text-xs font-medium rounded-full inline-flex items-center border border-red-100">
                                <i className="ph ph-shopping-cart-simple text-xs mr-1"></i>
                                {totalItems} {totalItems === 1 ? 'item' : 'items'}
                            </span>
                            <span className="hidden md:inline-flex px-2 py-0.5 bg-gray-50 text-gray-600 text-xs font-medium rounded-full items-center border border-gray-200">
                                <i className="ph ph-map-pin text-gray-500 mr-1"></i>
                                {order.address?.area || "In-store"}
                            </span>
                        </div>
                        <span className="text-2xs md:text-xs text-gray-500">
                            {orderSource}
                        </span>
                    </div>
                </div>

                {/* Action buttons - separate from clickable area */}
                {isNewOrder && (
                    <div className="border-t border-gray-100">
                        {/* Mobile buttons stacked for small screens */}
                        <div className="grid grid-cols-2 md:hidden">
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onAccept && onAccept();
                                }}
                                className="py-1.5 bg-white text-green-600 flex items-center justify-center gap-1 hover:bg-green-50 transition-colors text-xs font-medium cursor-default border-r border-gray-100"
                            >
                                <i className="ph ph-check text-sm"></i>
                                <span>Accept</span>
                            </button>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onReject && onReject();
                                }}
                                className="py-1.5 bg-white text-red-600 flex items-center justify-center gap-1 hover:bg-red-50 transition-colors text-xs font-medium cursor-default"
                            >
                                <i className="ph ph-x text-sm"></i>
                                <span>Reject</span>
                            </button>
                        </div>

                        {/* Desktop buttons - compact right-aligned */}
                        <div className="hidden md:flex justify-end p-2">
                            <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden shadow-sm">
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onAccept && onAccept();
                                    }}
                                    className="px-3 py-1.5 bg-white text-green-600 flex items-center justify-center gap-1.5 hover:bg-green-50 transition-colors text-xs font-medium cursor-default border-r border-gray-200"
                                >
                                    <i className="ph ph-check"></i>
                                    <span>Accept</span>
                                </button>
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onReject && onReject();
                                    }}
                                    className="px-3 py-1.5 bg-white text-red-600 flex items-center justify-center gap-1.5 hover:bg-red-50 transition-colors text-xs font-medium cursor-default"
                                >
                                    <i className="ph ph-x"></i>
                                    <span>Reject</span>
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

// Order Details Modal Component
export function OrderDetailsModal({ order, onClose, onAccept, onReject, onPrintBill }) {
    const totalAmount = order.items?.reduce((sum, item) => sum + ((item.price || 0) * (item.quantity || item.qnt || 1)), 0) || 0;

    // Use ChargesCalculator for consistent charge calculations
    const chargesCalculation = ChargesCalculator?.calculateCharges(
        totalAmount,
        order.charges || [],
        order.discount || 0
    ) || {
        subtotal: totalAmount,
        discount: order.discount || 0,
        calculatedCharges: [],
        finalAmount: totalAmount - (order.discount || 0)
    };

    const { calculatedCharges, finalAmount } = chargesCalculation;

    // Determine order status for showing appropriate actions
    const isNewOrder = order.currentStatus?.label === "PLACED";
    const isCompletedOrder = order.currentStatus?.label === "COMPLETED" || order.paid === true;
    const isProcessingOrder = order.currentStatus?.label === "KITCHEN";

    // Get payment mode display name
    const getPaymentModeDisplay = (payMode) => {
        if (!payMode) return "Not Paid";

        switch (payMode.toUpperCase()) {
            case 'CASH': return 'Cash Payment';
            case 'DIGITAL': return 'Digital Payment';
            case 'CREDIT': return 'Credit Payment';
            default: return payMode;
        }
    };

    return (
        <div
            className="fixed inset-0 bg-black bg-opacity-50 z-50 flex justify-end"
            onClick={onClose}
        >
            <div
                className="bg-gradient-to-br from-warm-bg to-white w-full max-w-md h-full overflow-y-auto animate-slide-in-right shadow-section"
                onClick={e => e.stopPropagation()}
            >
                <div className="sticky top-0 bg-white border-b border-gray-200 z-10 px-4 py-3 flex items-center justify-between">
                    <h2 className="text-lg font-semibold text-gray-800">Order Details</h2>
                    <button
                        onClick={onClose}
                        className="w-8 h-8 flex items-center justify-center hover:bg-red-50 text-gray-600 rounded-full transition-colors"
                    >
                        <i className="ph ph-x"></i>
                    </button>
                </div>

                <div className="p-4 space-y-4">
                    {/* Customer Info */}
                    <div className="bg-gradient-to-br from-warm-bg to-white rounded-xl p-4 border border-gray-200 shadow-sm">
                        <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 bg-gradient-to-br from-red-50 to-white rounded-lg flex items-center justify-center shadow-sm">
                                    <i className="ph ph-user text-red-500 text-lg"></i>
                                </div>
                                <div>
                                    <h3 className="font-medium text-gray-900 truncate max-w-[160px]">
                                        {order.custName || "Guest Customer"}
                                    </h3>
                                    <p className="text-xs text-gray-500 truncate max-w-[160px]">
                                        {order.customer?.phone || "No phone"}
                                    </p>
                                </div>
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3 mt-3">
                            <div className="bg-gradient-to-br from-gray-100 to-gray-50 p-2 rounded-lg">
                                <p className="text-xs text-gray-500">Order ID</p>
                                <p className="font-medium text-sm">#{order.id?.slice(-6)}</p>
                            </div>
                            <div className="bg-gradient-to-br from-gray-100 to-gray-50 p-2 rounded-lg">
                                <p className="text-xs text-gray-500">Date & Time</p>
                                <p className="font-medium text-sm truncate">
                                    {formatDate(order.date, 'full')}
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Items List */}
                    <div>
                        <h3 className="text-sm font-semibold mb-2 text-gray-700 flex items-center">
                            <i className="ph ph-shopping-cart text-red-500 mr-1.5"></i>
                            Order Items
                        </h3>
                        <div className="space-y-2">
                            {order.items?.map((item, index) => (
                                <div key={index} className="flex items-center gap-2 p-3 bg-gradient-to-br from-warm-bg to-white rounded-lg border border-gray-200 shadow-sm">
                                    <div className="w-12 h-12 bg-gradient-to-br from-gray-100 to-white rounded-lg flex items-center justify-center flex-shrink-0 shadow-sm">
                                        {item.image ? (
                                            <img
                                                src={item.image}
                                                alt={item.title}
                                                className="w-full h-full object-cover rounded-lg"
                                                onError={(e) => {
                                                    e.target.onerror = null;
                                                    e.target.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 24 24" fill="none" stroke="%23ccc" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>';
                                                }}
                                            />
                                        ) : (
                                            <i className="ph ph-hamburger text-gray-400 text-lg"></i>
                                        )}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <h4 className="font-medium text-gray-900 truncate">{item.title}</h4>
                                        <div className="flex justify-between items-center mt-1">
                                            <p className="text-xs text-gray-500">
                                                {item.quantity || 1} x {UserSession?.getCurrency()}{item.price || 0}
                                            </p>
                                            <p className="font-medium text-sm">
                                                {UserSession?.getCurrency()}{(item.quantity || 1) * (item.price || 0)}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Bill Details */}
                    <div className="bg-gradient-to-br from-warm-bg to-white rounded-xl p-4 border border-gray-200 shadow-sm">
                        <h3 className="text-sm font-semibold mb-3 text-gray-700 flex items-center">
                            <i className="ph ph-receipt text-red-500 mr-1.5"></i>
                            Bill Details
                        </h3>
                        <div className="space-y-2 text-sm">
                            <div className="flex justify-between">
                                <span className="text-gray-600">Item Total</span>
                                <span className="font-medium">{UserSession?.getCurrency()}{totalAmount.toFixed(2)}</span>
                            </div>

                            {/* Display each charge */}
                            {calculatedCharges && calculatedCharges.length > 0 && calculatedCharges.map((charge, index) => {
                                return (
                                    <div key={index} className="flex justify-between">
                                        <span className="text-gray-600">{charge.displayName}</span>
                                        <span className="font-medium">{UserSession?.getCurrency()}{charge.calculatedAmount.toFixed(2)}</span>
                                    </div>
                                );
                            })}

                            {/* Display discount if any */}
                            {order.discount > 0 && (
                                <div className="flex justify-between text-green-600">
                                    <span>Discount</span>
                                    <span>- {UserSession?.getCurrency()}{order.discount.toFixed(2)}</span>
                                </div>
                            )}

                            <div className="border-t border-gray-200 pt-2 flex justify-between mt-2">
                                <span className="font-medium">Grand Total</span>
                                <span className="font-semibold text-red-600">{UserSession?.getCurrency()}{finalAmount.toFixed(2)}</span>
                            </div>
                            {order.payMode && (
                                <div className="flex justify-between items-center pt-1 text-xs">
                                    <span className="text-gray-600">Payment Method</span>
                                    <span className={`font-medium px-2 py-0.5 rounded-full ${order.payMode === 'CASH' ? 'bg-green-50 text-green-600' :
                                        order.payMode === 'DIGITAL' ? 'bg-red-50 text-red-600' :
                                            order.payMode === 'CREDIT' ? 'bg-orange-50 text-orange-600' :
                                                'bg-gray-50 text-gray-600'
                                        }`}>
                                        {getPaymentModeDisplay(order.payMode)}
                                    </span>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Order Status */}
                    <div className="bg-gradient-to-br from-warm-bg to-white rounded-xl p-4 border border-gray-200 shadow-sm">
                        <h3 className="text-sm font-semibold mb-3 text-gray-700 flex items-center">
                            <i className="ph ph-flag text-red-500 mr-1.5"></i>
                            Order Status
                        </h3>
                        <div className="flex items-center">
                            <div className={`px-3 py-1.5 rounded-full text-sm font-medium ${isNewOrder ? 'bg-red-100 text-red-600' :
                                isProcessingOrder ? 'bg-orange-100 text-orange-600' :
                                    isCompletedOrder ? 'bg-green-100 text-green-600' :
                                        'bg-gray-100 text-gray-600'
                                }`}>
                                <i className={`ph ${isNewOrder ? 'ph-hourglass text-red-600' :
                                    isProcessingOrder ? 'ph-cooking-pot text-orange-600' :
                                        isCompletedOrder ? 'ph-check-circle text-green-600' :
                                            'ph-question text-gray-600'
                                    } mr-1.5`}></i>
                                {order.currentStatus?.label?.toUpperCase() || "PLACED"}
                            </div>
                        </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="pt-2">
                        {isNewOrder && (
                            <div className="space-y-2">
                                <div className="flex gap-2">
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onAccept && onAccept();
                                            onClose();
                                        }}
                                        className="flex-1 py-2.5 bg-gradient-to-r from-green-600 to-green-500 text-white rounded-lg flex items-center justify-center gap-1.5 hover:from-green-700 hover:to-green-600 transition-colors text-sm font-medium shadow-sm"
                                    >
                                        <i className="ph ph-check"></i>
                                        <span>Accept Order</span>
                                    </button>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onReject && onReject();
                                            onClose();
                                        }}
                                        className="flex-1 py-2.5 bg-gradient-to-r from-red-600 to-red-500 text-white rounded-lg flex items-center justify-center gap-1.5 hover:from-red-700 hover:to-red-600 transition-colors text-sm font-medium shadow-sm"
                                    >
                                        <i className="ph ph-x"></i>
                                        <span>Reject Order</span>
                                    </button>
                                </div>
                            </div>
                        )}

                        {isProcessingOrder && (
                            <div>
                                <button
                                    onClick={async (e) => {
                                        e.stopPropagation();
                                        try {
                                            if (BluetoothPrinting) {
                                                // Show connecting message
                                                if (ModalManager && typeof ModalManager.showToast === 'function') {
                                                    if (!BluetoothPrinting.connected) {
                                                        ModalManager.showToast("Connecting to printer...", { type: "info" });
                                                    } else {
                                                        ModalManager.showToast("Printing kitchen order...", { type: "info" });
                                                    }
                                                }

                                                // Print the kitchen order directly
                                                await BluetoothPrinting.printKOT(order.id);

                                                // Show success message
                                                if (ModalManager && typeof ModalManager.showToast === 'function') {
                                                    ModalManager.showToast("Kitchen order printed successfully", { type: "success" });
                                                }
                                            } else if (onPrintBill) {
                                                onPrintBill(order.id);
                                            } else {
                                                console.error("BluetoothPrinting service not available");
                                                if (ModalManager && typeof ModalManager.showToast === 'function') {
                                                    ModalManager.showToast("Printing service not available", { type: "error" });
                                                }
                                            }
                                        } catch (error) {
                                            console.error("Error printing kitchen order:", error);
                                            if (ModalManager && typeof ModalManager.showToast === 'function') {
                                                ModalManager.showToast("Failed to print kitchen order: " + error.message, { type: "error" });
                                            }
                                        }
                                        onClose();
                                    }}
                                    className="w-full py-3 bg-gradient-to-r from-red-600 to-red-500 text-white rounded-lg flex items-center justify-center gap-2 hover:from-red-700 hover:to-red-600 transition-colors text-sm font-medium shadow-sm"
                                >
                                    <i className="ph ph-printer text-lg"></i>
                                    <span>Print Kitchen Order</span>
                                </button>
                            </div>
                        )}

                        {isCompletedOrder && (
                            <div>
                                <button
                                    id="print-bill-button"
                                    data-action="print-bill"
                                    onclick="if(modalPrintBill) { modalPrintBill(); return false; }"
                                    className="w-full py-3 bg-gradient-to-r from-red-600 to-red-500 text-white rounded-lg flex items-center justify-center gap-2 hover:from-red-700 hover:to-red-600 transition-colors text-sm font-medium shadow-sm"
                                >
                                    <i className="ph ph-printer text-lg"></i>
                                    <span>Print Bill</span>
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

// Order Details Content Component for use with ModalManager
export function OrderDetailsContent({ order, modalControl }) {
    const totalAmount = order.items?.reduce((sum, item) => sum + ((item.price || 0) * (item.quantity || item.qnt || 1)), 0) || 0;

    // Use ChargesCalculator for consistent charge calculations
    const chargesCalculation = ChargesCalculator?.calculateCharges(
        totalAmount,
        order.charges || [],
        order.discount || 0
    ) || {
        subtotal: totalAmount,
        discount: order.discount || 0,
        calculatedCharges: [],
        finalAmount: totalAmount - (order.discount || 0)
    };

    const { calculatedCharges, finalAmount } = chargesCalculation;

    // Determine order status for showing appropriate actions
    const isNewOrder = order.currentStatus?.label === "PLACED";
    const isCompletedOrder = order.currentStatus?.label === "COMPLETED" || order.paid === true;
    const isProcessingOrder = order.currentStatus?.label === "KITCHEN";

    // Get payment mode display name
    const getPaymentModeDisplay = (payMode) => {
        if (!payMode) return "Not Paid";

        switch (payMode.toUpperCase()) {
            case 'CASH': return 'Cash Payment';
            case 'DIGITAL': return 'Digital Payment';
            case 'CREDIT': return 'Credit Payment';
            default: return payMode;
        }
    };

    useEffect(() => {
        modalControl.setTitle('Order Details');

        // Set up the print bill handler for DOM access
        modalControl.printBillHandler = handlePrintBill;

        // Set up a global handler that can be called from onclick HTML attribute
        modalPrintBill = () => {
            console.log("Print bill triggered from global handler");
            handlePrintBill();
            return false; // Prevent default
        };

        // After component is rendered and HTML is injected, set up DOM event listener
        setTimeout(() => {
            const printButton = document.getElementById('print-bill-button');
            if (printButton) {
                printButton.addEventListener('click', (e) => {
                    e.preventDefault();
                    console.log("Print bill button clicked via DOM event");
                    handlePrintBill();
                });
            }
        }, 100);

        // Cleanup function
        return () => {
            modalPrintBill = null;
        };
    }, []);

    function handlePrintBill() {
        console.log("Printing bill");
        try {
            if (BluetoothPrinting) {
                console.log("Printing bill...", order.id);
                // Print the bill directly
                BluetoothPrinting.printBill(order.id);

                // Show success message
                if (ModalManager && typeof ModalManager.showToast === 'function') {
                    ModalManager.showToast("Bill printed successfully", { type: "success" });
                }
            } else {
                console.error("BluetoothPrinting service not available");
                if (ModalManager && typeof ModalManager.showToast === 'function') {
                    ModalManager.showToast("Printing service not available", { type: "error" });
                }
            }
        } catch (error) {
            console.error("Error printing bill:", error);
            if (ModalManager && typeof ModalManager.showToast === 'function') {
                ModalManager.showToast("Failed to print bill: " + error.message, { type: "error" });
            }
        }
        modalControl.close();
    }

    return (
        <div className="p-4 space-y-4">
            {/* Customer Info */}
            <div className="bg-gradient-to-br from-warm-bg to-white rounded-xl p-4 border border-gray-200 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-gradient-to-br from-red-50 to-white rounded-lg flex items-center justify-center shadow-sm">
                            <i className="ph ph-user text-red-500 text-lg"></i>
                        </div>
                        <div>
                            <h3 className="font-medium text-gray-900 truncate max-w-[160px]">
                                {order.custName || "Guest Customer"}
                            </h3>
                            <p className="text-xs text-gray-500 truncate max-w-[160px]">
                                {order.customer?.phone || "No phone"}
                            </p>
                        </div>
                    </div>
                </div>
                <div className="grid grid-cols-2 gap-3 mt-3">
                    <div className="bg-gradient-to-br from-gray-100 to-gray-50 p-2 rounded-lg">
                        <p className="text-xs text-gray-500">Order ID</p>
                        <p className="font-medium text-sm">#{order.id?.slice(-6)}</p>
                    </div>
                    <div className="bg-gradient-to-br from-gray-100 to-gray-50 p-2 rounded-lg">
                        <p className="text-xs text-gray-500">Date & Time</p>
                        <p className="font-medium text-sm truncate">
                            {formatDate(order.date, 'full')}
                        </p>
                    </div>
                </div>
            </div>

            {/* Items List */}
            <div>
                <h3 className="text-sm font-semibold mb-2 text-gray-700 flex items-center">
                    <i className="ph ph-shopping-cart text-red-500 mr-1.5"></i>
                    Order Items
                </h3>
                <div className="space-y-2">
                    {order.items?.map((item, index) => (
                        <div key={index} className="flex items-center gap-2 p-3 bg-gradient-to-br from-warm-bg to-white rounded-lg border border-gray-200 shadow-sm">
                            <div className="w-12 h-12 bg-gradient-to-br from-gray-100 to-white rounded-lg flex items-center justify-center flex-shrink-0 shadow-sm">
                                {item.image ? (
                                    <img
                                        src={item.image}
                                        alt={item.title}
                                        className="w-full h-full object-cover rounded-lg"
                                        onError={(e) => {
                                            e.target.onerror = null;
                                            e.target.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 24 24" fill="none" stroke="%23ccc" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>';
                                        }}
                                    />
                                ) : (
                                    <i className="ph ph-hamburger text-gray-400 text-lg"></i>
                                )}
                            </div>
                            <div className="flex-1 min-w-0">
                                <h4 className="font-medium text-gray-900 truncate">{item.title}</h4>
                                <div className="flex justify-between items-center mt-1">
                                    <p className="text-xs text-gray-500">
                                        {item.quantity || 1} x {UserSession?.getCurrency()}{item.price || 0}
                                    </p>
                                    <p className="font-medium text-sm">
                                        {UserSession?.getCurrency()}{(item.quantity || 1) * (item.price || 0)}
                                    </p>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Bill Details */}
            <div className="bg-gradient-to-br from-warm-bg to-white rounded-xl p-4 border border-gray-200 shadow-sm">
                <h3 className="text-sm font-semibold mb-3 text-gray-700 flex items-center">
                    <i className="ph ph-receipt text-red-500 mr-1.5"></i>
                    Bill Details
                </h3>
                <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                        <span className="text-gray-600">Item Total</span>
                        <span className="font-medium">{UserSession?.getCurrency()}{totalAmount.toFixed(2)}</span>
                    </div>

                    {/* Display each charge */}
                    {calculatedCharges && calculatedCharges.length > 0 && calculatedCharges.map((charge, index) => {
                        return (
                            <div key={index} className="flex justify-between">
                                <span className="text-gray-600">{charge.displayName}</span>
                                <span className="font-medium">{UserSession?.getCurrency()}{charge.calculatedAmount.toFixed(2)}</span>
                            </div>
                        );
                    })}

                    {/* Display discount if any */}
                    {order.discount > 0 && (
                        <div className="flex justify-between text-green-600">
                            <span>Discount</span>
                            <span>- {UserSession?.getCurrency()}{order.discount.toFixed(2)}</span>
                        </div>
                    )}

                    <div className="border-t border-gray-200 pt-2 flex justify-between mt-2">
                        <span className="font-medium">Grand Total</span>
                        <span className="font-semibold text-red-600">{UserSession?.getCurrency()}{finalAmount.toFixed(2)}</span>
                    </div>
                    {order.payMode && (
                        <div className="flex justify-between items-center pt-1 text-xs">
                            <span className="text-gray-600">Payment Method</span>
                            <span className={`font-medium px-2 py-0.5 rounded-full ${order.payMode === 'CASH' ? 'bg-green-50 text-green-600' :
                                order.payMode === 'DIGITAL' ? 'bg-red-50 text-red-600' :
                                    order.payMode === 'CREDIT' ? 'bg-orange-50 text-orange-600' :
                                        'bg-gray-50 text-gray-600'
                                }`}>
                                {getPaymentModeDisplay(order.payMode)}
                            </span>
                        </div>
                    )}
                </div>
            </div>

            {/* Order Status */}
            <div className="bg-gradient-to-br from-warm-bg to-white rounded-xl p-4 border border-gray-200 shadow-sm">
                <h3 className="text-sm font-semibold mb-3 text-gray-700 flex items-center">
                    <i className="ph ph-flag text-red-500 mr-1.5"></i>
                    Order Status
                </h3>
                <div className="flex items-center">
                    <div className={`px-3 py-1.5 rounded-full text-sm font-medium ${isNewOrder ? 'bg-red-100 text-red-600' :
                        isProcessingOrder ? 'bg-orange-100 text-orange-600' :
                            isCompletedOrder ? 'bg-green-100 text-green-600' :
                                'bg-gray-100 text-gray-600'
                        }`}>
                        <i className={`ph ${isNewOrder ? 'ph-hourglass text-red-600' :
                            isProcessingOrder ? 'ph-cooking-pot text-orange-600' :
                                isCompletedOrder ? 'ph-check-circle text-green-600' :
                                    'ph-question text-gray-600'
                            } mr-1.5`}></i>
                        {order.currentStatus?.label?.toUpperCase() || "PLACED"}
                    </div>
                </div>
            </div>

            {/* Action Buttons */}
            {isNewOrder && (
                <div className="pt-2 space-y-2">
                    <div className="flex gap-2">
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                modalControl.close();
                                modalControl.acceptOrder && modalControl.acceptOrder();
                            }}
                            className="flex-1 py-2.5 bg-gradient-to-r from-green-600 to-green-500 text-white rounded-lg flex items-center justify-center gap-1.5 hover:from-green-700 hover:to-green-600 transition-colors text-sm font-medium shadow-sm"
                        >
                            <i className="ph ph-check"></i>
                            <span>Accept Order</span>
                        </button>
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                modalControl.close();
                                modalControl.rejectOrder && modalControl.rejectOrder();
                            }}
                            className="flex-1 py-2.5 bg-gradient-to-r from-red-600 to-red-500 text-white rounded-lg flex items-center justify-center gap-1.5 hover:from-red-700 hover:to-red-600 transition-colors text-sm font-medium shadow-sm"
                        >
                            <i className="ph ph-x"></i>
                            <span>Reject Order</span>
                        </button>
                    </div>
                </div>
            )}

            {isProcessingOrder && (
                <button
                    onClick={async (e) => {
                        e.stopPropagation();
                        try {
                            if (BluetoothPrinting) {
                                // Show connecting message
                                if (ModalManager && typeof ModalManager.showToast === 'function') {
                                    if (!BluetoothPrinting.connected) {
                                        ModalManager.showToast("Connecting to printer...", { type: "info" });
                                    } else {
                                        ModalManager.showToast("Printing kitchen order...", { type: "info" });
                                    }
                                }

                                // Print the kitchen order directly
                                await BluetoothPrinting.printKOT(order.id);

                                // Show success message
                                if (ModalManager && typeof ModalManager.showToast === 'function') {
                                    ModalManager.showToast("Kitchen order printed successfully", { type: "success" });
                                }
                            } else if (onPrintBill) {
                                onPrintBill(order.id);
                            } else {
                                console.error("BluetoothPrinting service not available");
                                if (ModalManager && typeof ModalManager.showToast === 'function') {
                                    ModalManager.showToast("Printing service not available", { type: "error" });
                                }
                            }
                        } catch (error) {
                            console.error("Error printing kitchen order:", error);
                            if (ModalManager && typeof ModalManager.showToast === 'function') {
                                ModalManager.showToast("Failed to print kitchen order: " + error.message, { type: "error" });
                            }
                        }
                        modalControl.close();
                    }}
                    className="w-full py-3 bg-gradient-to-r from-red-600 to-red-500 text-white rounded-lg flex items-center justify-center gap-2 hover:from-red-700 hover:to-red-600 transition-colors text-sm font-medium shadow-sm mt-2"
                >
                    <i className="ph ph-printer text-lg"></i>
                    <span>Print Kitchen Order</span>
                </button>
            )}

            {isCompletedOrder && (
                <button
                    id="print-bill-button"
                    data-action="print-bill"
                    onclick="if(modalPrintBill) { modalPrintBill(); return false; }"
                    className="w-full py-3 bg-gradient-to-r from-red-600 to-red-500 text-white rounded-lg flex items-center justify-center gap-2 hover:from-red-700 hover:to-red-600 transition-colors text-sm font-medium shadow-sm"
                >
                    <i className="ph ph-printer text-lg"></i>
                    <span>Print Bill</span>
                </button>
            )}
        </div>
    );
}

// No Orders Found Component
export function NoOrdersFound() {
    return (
        <div className="flex flex-col items-center justify-center py-20 opacity-30">
            <i className="ph ph-table text-5xl text-red-800 mb-4"></i>
            <p className="text-xl font-bold text-red-800 text-center">
                No tables added yet
            </p>
        </div>
    );
}
