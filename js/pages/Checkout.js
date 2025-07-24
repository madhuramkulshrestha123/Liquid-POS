import { useState, useEffect, useRef } from 'react';
import { PaymentMode } from '../models/Order.js';
import { OrderStatus } from '../models/OrderStatus.js';
import { showToast } from '../utils.js';
import { UserSession } from '../utils/UserSession.js';
import { sdk } from '../sdk.js';
import { BluetoothPrinting } from '../utils/BluetoothPrinting.js';

// Checkout Component for Shopto
export function CheckoutSheet({ order, onClose }) {
    const [paymentMode, setPaymentMode] = useState('Cash');
    const [showContent, setShowContent] = useState(true);
    const [customer, setCustomer] = useState(null);
    const [isPrinting, setIsPrinting] = useState(false);

    // Handle checkout process
    const handleCheckout = async (mode) => {
        try {
            // Prepare changes
            const data = {
                payMode: mode,
            };

            if (customer) {
                data.custId = customer.id;
                data.custName = customer.name;
                data.custPhone = customer.phone;
            }

            if (mode === PaymentMode.CREDIT) {
                data.paid = false;
            }

            // Set local changes first
            order.data = { ...order.data, ...data };

            // Update in Firestore
            await order.ref.update(data);

            // --- Place order in QR order section and tag as 'Placed' ---
            // Set status to PLACED only (not COMPLETED)
            const placedStatus = {
                label: OrderStatus.PLACED,
                date: new Date()
            };
            // Get current order data
            const orderDoc = await order.ref.get();
            const orderData = orderDoc.data();
            
            // Get current status array or create empty one
            const currentStatus = orderData.status || [];
            
            // Add new status
            const updatedStatus = [...currentStatus, placedStatus];
            
            await order.ref.update({
                currentStatus: placedStatus,
                status: updatedStatus
            });
            // --- End status update ---

            // Print bill (you'll need to implement this)
            // printBill(order);

            // Track analytics
            console.log("Order_Checkout", {
                mode: mode,
                tableId: order.tableId,
                variant: order.priceVariant,
                total: order.total
            });

            showToast("Order placed successfully", "success");
            onClose();
        } catch (error) {
            console.error("Checkout error:", error);
            showToast("Failed to complete order", "error");
        }
    };

    // Items list section
    const ItemsList = () => (
        <div className={`transition-all duration-500 overflow-hidden ${showContent ? 'max-h-60' : 'max-h-0'} mb-5`}>
            <div className="overflow-y-auto">
                {order.items.map((item, index) => (
                    <div key={index} className="flex items-center p-4 border-b">
                        <div className="w-12 h-12 bg-gray-100 rounded-lg overflow-hidden flex-shrink-0">
                            {item.thumb ? (
                                <img
                                    src={item.thumb}
                                    alt={item.title}
                                    className="w-full h-full object-cover"
                                    onError={(e) => {
                                        e.target.onerror = null;
                                        e.target.src = 'https://via.placeholder.com/50';
                                    }}
                                />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center">
                                    <i className="ph ph-image text-gray-400 text-xl"></i>
                                </div>
                            )}
                        </div>
                        <div className="ml-4 flex-1">
                            <h3 className="font-medium">{item.title}</h3>
                            <p className="text-sm text-gray-500">Qty: {item.qnt}</p>
                        </div>
                        <div className="text-right">
                            <span className="font-medium">{UserSession?.getCurrency()}{item.price}</span>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );

    // Summary section
    const Summary = () => (
        <div className="px-5 mb-5">
            <div className="flex items-start justify-between">
                <DiscountButton
                    initialDiscount={order.discount}
                    maxDiscount={order.subTotal}
                    onDiscountChange={(discount) => {
                        if (discount > order.subTotal) {
                            showToast("Discount cannot be greater than total amount");
                            order.setDiscount(0);
                        } else {
                            order.setDiscount(discount);
                        }
                    }}
                />
                <div className="text-right">
                    <p className="text-gray-700">Sub Total: {UserSession?.getCurrency()}{order.subTotal}</p>
                    <p className="text-green-600 mt-1">Discount: - {UserSession?.getCurrency()}{order.discount}</p>
                    <p className="text-xl font-bold mt-4">Pay Total: {UserSession?.getCurrency()}{order.total}</p>
                </div>
            </div>
        </div>
    );

    // Customer section
    const CustomerSection = () => (
        <div className="mb-5">
            {customer ? (
                <div className="mx-4 p-4 bg-blue-50 rounded-lg">
                    <div className="flex items-center justify-between">
                        <div>
                            <h3 className="font-medium">{customer.name}</h3>
                            <p className="text-sm text-gray-600">{customer.phone}</p>
                        </div>
                        <button
                            onClick={() => setCustomer(null)}
                            className="p-2 hover:bg-blue-100 rounded-full"
                        >
                            <i className="ph ph-x"></i>
                        </button>
                    </div>
                </div>
            ) : (
                <AddCustomer
                    onSelectCustomer={setCustomer}
                    onContentVisibilityChange={setShowContent}
                />
            )}
        </div>
    );

    // Payment buttons section
    const PaymentButtons = () => (
        <div className="px-4 grid grid-cols-3 gap-3">
            <button
                className={`px-4 py-3 rounded-lg font-medium ${customer ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-gray-200 text-gray-500 cursor-not-allowed'}`}
                onClick={() => customer && handleCheckout(PaymentMode.CREDIT)}
                disabled={!customer}
            >
                Credit
            </button>
            <button
                className="px-4 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700"
                onClick={() => handleCheckout(PaymentMode.DIGITAL)}
            >
                UPI/Card
            </button>
            <button
                className="px-4 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700"
                onClick={() => handleCheckout(PaymentMode.CASH)}
            >
                Cash
            </button>
        </div>
    );

    // Print bill button
    const handlePrintBill = async () => {
        if (!order || !order.id) {
            showToast("No order available to print", "error");
            return;
        }

        setIsPrinting(true);
        try {
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
                const paymentMode = order.payMode || 'CASH';
                const channel = order.priceVariant || 'Default';
                
                await BluetoothPrinting.printBill(order.id, paymentMode, false, channel);
                showToast("Bill printed successfully", "success");
            } else {
                showToast("Printing service not available on this device", "error");
            }
        } catch (error) {
            console.error('Error printing bill:', error);
            showToast(`Failed to print bill: ${error.message}`, "error");
        } finally {
            setIsPrinting(false);
        }
    };

    return (
        <div className="bg-white rounded-t-xl max-h-[90vh] overflow-y-auto">
            <div className="p-4">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xl font-bold">Checkout</h2>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-gray-100 rounded-full"
                    >
                        <i className="ph ph-x"></i>
                    </button>
                </div>
                <div className="border-b mb-4"></div>
                <ItemsList />
                <Summary />
                <CustomerSection />
                <PaymentButtons />
                
                {/* Print Bill Button */}
                <div className="mt-4 px-4">
                    <button
                        onClick={handlePrintBill}
                        disabled={isPrinting}
                        className="w-full py-3 bg-red-500 text-white rounded-lg font-medium hover:bg-red-600 flex items-center justify-center gap-2"
                    >
                        <i className="ph ph-printer text-lg"></i>
                        <span>{isPrinting ? 'Printing...' : 'Print Bill'}</span>
                    </button>
                </div>
            </div>
        </div>
    );
}

// Discount Button Component
export function DiscountButton({ initialDiscount = 0, maxDiscount, onDiscountChange }) {
    const [isOpen, setIsOpen] = useState(false);
    const [discount, setDiscount] = useState(initialDiscount);
    const inputRef = useRef(null);

    const handleDiscountChange = (value) => {
        const newDiscount = Math.min(Number(value) || 0, maxDiscount);
        setDiscount(newDiscount);
        onDiscountChange(newDiscount);
    };

    return (
        <div className="relative">
            <button
                onClick={() => {
                    setIsOpen(!isOpen);
                    if (!isOpen) {
                        setTimeout(() => inputRef.current?.focus(), 100);
                    }
                }}
                className="px-4 py-2 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 transition-colors flex items-center gap-2"
            >
                <i className="ph ph-tag"></i>
                <span>Discount</span>
            </button>

            {isOpen && (
                <div className="absolute top-full left-0 mt-2 bg-white rounded-lg shadow-lg p-4 w-64 z-10">
                    <div className="mb-4">
                        <label className="block text-sm text-gray-600 mb-1">Enter Discount Amount</label>
                        <input
                            ref={inputRef}
                            type="number"
                            value={discount}
                            onChange={(e) => handleDiscountChange(e.target.value)}
                            className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="0"
                            min="0"
                            max={maxDiscount}
                        />
                    </div>
                    <div className="flex justify-end">
                        <button
                            onClick={() => setIsOpen(false)}
                            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                        >
                            Apply
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

// Add Customer Component
export function AddCustomer({ onSelectCustomer, onContentVisibilityChange }) {
    const [customers, setCustomers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [formData, setFormData] = useState({ name: '', phone: '' });
    const formRef = useRef(null);
    const nameInputRef = useRef(null);

    // Fetch customers on mount
    useEffect(() => {
        fetchCustomers();
    }, []);

    const fetchCustomers = async () => {
        try {
            const snapshot = await sdk.db.collection("Customers").get();
            const customersList = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            setCustomers(customersList);
            setLoading(false);
        } catch (err) {
            console.error("Error fetching customers:", err);
            setError("Failed to load customers");
            setLoading(false);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();

        if (!formData.name || !formData.phone) {
            showToast("Please fill all required fields", "error");
            return;
        }

        try {
            // Check if customer already exists
            const existingCustomer = customers.find(c => c.phone === formData.phone);
            if (existingCustomer) {
                onSelectCustomer(existingCustomer);
                return;
            }

            // Create new customer
            const customerData = {
                name: formData.name,
                phone: formData.phone,
                date: new Date(),
                totalSpent: 0,
                orderCount: 0
            };

            const docRef = await sdk.db.collection("Customers").add(customerData);
            const newCustomer = { id: docRef.id, ...customerData };

            onSelectCustomer(newCustomer);
            showToast("Customer added successfully");
        } catch (err) {
            console.error("Error adding customer:", err);
            showToast("Failed to add customer", "error");
        }
    };

    if (loading) {
        return (
            <div className="p-4 text-center">
                <div className="animate-spin inline-block w-6 h-6 border-3 border-blue-600 border-t-transparent rounded-full"></div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="p-4 text-center text-red-600">
                {error}
            </div>
        );
    }

    return (
        <div className="px-4">
            <form ref={formRef} onSubmit={handleSubmit} className="space-y-4">
                {/* Name Input with Autocomplete */}
                <div>
                    <input
                        ref={nameInputRef}
                        type="text"
                        value={formData.name}
                        onChange={(e) => {
                            setFormData(prev => ({ ...prev, name: e.target.value }));
                            // Show matching customers in dropdown
                            const matchingCustomers = customers.filter(c =>
                                c.name.toLowerCase().includes(e.target.value.toLowerCase())
                            );
                            // Update dropdown here
                        }}
                        onFocus={() => onContentVisibilityChange(false)}
                        onBlur={() => onContentVisibilityChange(true)}
                        className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="Customer Name"
                        required
                    />
                </div>

                {/* Phone Input with Autocomplete */}
                {formData.name && (
                    <div>
                        <input
                            type="tel"
                            value={formData.phone}
                            onChange={(e) => {
                                setFormData(prev => ({ ...prev, phone: e.target.value }));
                                // Show matching customers in dropdown
                                const matchingCustomers = customers.filter(c =>
                                    c.phone.includes(e.target.value)
                                );
                                // Update dropdown here
                            }}
                            onFocus={() => onContentVisibilityChange(false)}
                            onBlur={() => onContentVisibilityChange(true)}
                            className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="Phone Number"
                            required
                        />
                    </div>
                )}
            </form>

            {/* Customer Suggestions */}
            <div className="mt-2">
                {customers
                    .filter(c =>
                        c.name.toLowerCase().includes(formData.name.toLowerCase()) ||
                        c.phone.includes(formData.phone)
                    )
                    .slice(0, 3)
                    .map(customer => (
                        <div
                            key={customer.id}
                            className="p-3 bg-white border rounded-lg mb-2 cursor-pointer hover:bg-gray-50"
                            onClick={() => onSelectCustomer(customer)}
                        >
                            <div className="font-medium">{customer.name}</div>
                            <div className="text-sm text-gray-600">{customer.phone}</div>
                        </div>
                    ))}
            </div>
        </div>
    );
}
