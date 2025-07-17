import { UserSession } from '../utils/UserSession.js';
import { sdk } from '../sdk.js';

// Order models for Shopto
const DUMMY_THUMB = "https://firebasestorage.googleapis.com/v0/b/frihbi-app.appspot.com/o/assets%2Fproduct-placeholder.png?alt=media&token=183bdac4-2f9b-4645-8147-7cfa921ba0e9";

// Payment modes enum
export const PaymentMode = {
    DIGITAL: "DIGITAL",
    CASH: "CASH",
    CREDIT: "CREDIT"
};

// Order status enum
export const OrderStatus = {
    PLACED: "PLACED",
    KITCHEN: "KITCHEN",
    COMPLETED: "COMPLETED",
    CANCELLED: "CANCELLED"
};

// Helper function to convert string to PaymentMode
function asPaymentMode(mode) {
    return Object.values(PaymentMode).includes(mode) ? mode : PaymentMode.CASH;
}

// Charge class for additional charges like tax, packaging, etc.
export class Charge {
    constructor(data = {}) {
        this.name = data.name || '';
        this.value = data.value || 0;
        this.type = data.type || 'percentage'; // 'percentage' or 'fixed'
        this.inclusive = data.inclusive || false;
        this.bulkTaxHashtag = data.bulkTaxHashtag || null; // Add support for bulk tax update hashtag
    }

    static fromJson(json) {
        return new Charge(json);
    }

    toJson() {
        return {
            name: this.name,
            value: this.value,
            type: this.type,
            inclusive: this.inclusive,
            bulkTaxHashtag: this.bulkTaxHashtag // Include hashtag in JSON
        };
    }

    // Calculate charge amount based on base price
    calculate(basePrice) {
        if (this.type === 'percentage') {
            // Handle both numeric values and string values with '%'
            let percentValue = this.value;
            if (typeof percentValue === 'string') {
                percentValue = parseFloat(percentValue.replace('%', '').trim()) || 0;
            } else {
                percentValue = parseFloat(percentValue) || 0;
            }
            return (basePrice * percentValue) / 100;
        }
        return parseFloat(this.value) || 0;
    }
}

// Item class - equivalent to Flutter Item
export class Item {
    constructor(data) {
        this.data = data;
    }

    // Constructor from Product
    static fromProduct(product, qnt, variant = null, addons = []) {
        const itemData = {
            pid: product.id,
            title: product.title,
            thumb: product.imgs && product.imgs.length > 0 ? product.imgs[0] : null,
            cat: product.cat,
            mrp: product.mrp,
            price: variant ? variant.price : product.price,
            veg: product.veg,
            served: false,
            qnt: qnt,
            variantId: variant ? variant.id : null,
            variantName: variant ? variant.name : null,
            variantPrice: variant ? variant.price : null,
            addons: addons.map(addon => ({
                id: addon.id,
                name: addon.name,
                price: addon.price
            })),
            addonsTotal: addons.reduce((sum, addon) => sum + addon.price, 0)
        };

        // Include tax update information if present
        if (product.taxUpdateInfo) {
            itemData.taxUpdateInfo = product.taxUpdateInfo;
        }

        return new Item(itemData);
    }

    // Getters
    get pid() {
        return this.data?.pid;
    }

    get title() {
        return this.data?.title;
    }

    get thumb() {
        return this.data?.thumb || DUMMY_THUMB;
    }

    get cat() {
        return this.data?.cat;
    }

    get qnt() {
        return this.data?.qnt || 0;
    }

    get mrp() {
        return this.data?.mrp || 0;
    }

    get price() {
        return this.data?.price || 0;
    }

    get served() {
        return this.data?.served || false;
    }

    get veg() {
        return this.data?.veg || false;
    }

    get subTotal() {
        return this.price * this.qnt;
    }

    // Update served status locally
    serveLocally(served) {
        this.data.served = served;
    }
}

// Order Status Entry class
export class OrderStatusEntry {
    constructor(statusData) {
        this.statusData = statusData;
    }

    get label() {
        return this.statusData?.label;
    }

    get date() {
        return this.statusData?.date?.toDate ?
            this.statusData.date.toDate() :
            new Date(this.statusData?.date);
    }
}

// MOrder class - equivalent to Flutter MOrder
export class MOrder {
    constructor(data) {
        this.data = data;
    }

    // Constructor with required fields
    static fromItems(id, items, discount, priceVariant, tableId, instructions, charges) {
        const now = new Date();
        const seller = UserSession?.seller;
        const billNo = seller?.getBillNo ? seller.getBillNo() : Math.floor(Math.random() * 1000000);

        // Check if there's a bulk tax update hashtag in the charges
        let taxUpdateInfo = null;
        if (charges && charges.length > 0) {
            const bulkTaxCharge = charges.find(charge => charge.bulkTaxHashtag);
            if (bulkTaxCharge) {
                taxUpdateInfo = {
                    isFromBulkUpdate: true,
                    hashtag: bulkTaxCharge.bulkTaxHashtag,
                    timestamp: new Date().toISOString()
                };
            }
        }
        
        // Determine if this is an online order and set source
        let isOnline = false;
        let source = null;
        let orderType = null;
        
        if (priceVariant && (priceVariant.toLowerCase() === 'swiggy' || priceVariant.toLowerCase() === 'zomato')) {
            isOnline = true;
            source = priceVariant.toLowerCase();
        } else if (tableId && tableId.toLowerCase().includes('ac') || 
                   tableId && tableId.toLowerCase().includes('dining')) {
            isOnline = false;
            orderType = 'dine-in';
        } else if (priceVariant && priceVariant.toLowerCase().includes('online')) {
            isOnline = true;
        } else if (tableId) {
            // Default for tables is offline
            isOnline = false;
        }

        return new MOrder({
            id: id,
            billNo: billNo,
            items: items.map(item => item.data || item),
            sellerId: seller?.id,
            priceVariant: priceVariant,
            tableId: tableId,
            discount: discount,
            paid: false,
            status: [
                {
                    label: OrderStatus.PLACED,
                    date: now
                },
                {
                    label: OrderStatus.KITCHEN,
                    date: now
                }
            ],
            currentStatus: {
                label: OrderStatus.KITCHEN,
                date: now
            },
            charges: charges.map(charge => typeof charge.toJson === 'function' ? charge.toJson() : charge),
            taxUpdateInfo: taxUpdateInfo,
            payMode: PaymentMode.CASH,
            instructions: instructions,
            date: now,
            isOnline: isOnline,
            source: source,
            orderType: orderType
        });
    }

    // Getters
    get charges() {
        return this.data?.charges?.map(charge => new Charge(charge)) || [];
    }

    get id() {
        return this.data?.id;
    }

    get billNo() {
        return this.data?.billNo;
    }

    get custId() {
        return this.data?.custId;
    }

    get custName() {
        return this.data?.custName;
    }

    get custPhone() {
        return this.data?.custPhone;
    }

    get items() {
        return this.data?.items?.map(item => new Item(item)) || [];
    }

    get description() {
        return this.items.map(item => `${item.title} x ${item.qnt}`).join(', ');
    }

    get placeDate() {
        return this.data?.date?.toDate ?
            this.data.date.toDate() :
            new Date(this.data?.date);
    }

    get discount() {
        return this.data?.discount || 0;
    }

    get paid() {
        return this.data?.paid || false;
    }

    get priceVariant() {
        return this.data?.priceVariant;
    }

    get orderSource() {
        return this.priceVariant || this.tableId;
    }

    get tableId() {
        return this.data?.tableId;
    }

    get sellerId() {
        return this.data?.sellerId;
    }

    get instructions() {
        return this.data?.instructions;
    }

    get payMode() {
        return asPaymentMode(this.data?.payMode);
    }

    get subTotal() {
        return this.items.reduce((total, item) => total + item.subTotal, 0);
    }

    get total() {
        let totalAmt = this.subTotal - this.discount;
        let chargesAmt = 0;

        // Add exclusive charges
        this.charges.forEach(charge => {
            if (!charge.inclusive) {
                chargesAmt += parseFloat(charge.value);
            }
        });

        totalAmt += Math.floor(chargesAmt);
        return totalAmt;
    }

    get totalItems() {
        return this.items.reduce((total, item) => total + item.qnt, 0);
    }

    get servedItems() {
        return this.items.reduce((total, item) => total + (item.served ? item.qnt : 0), 0);
    }

    get currentStatus() {
        return new OrderStatusEntry(this.data?.currentStatus);
    }

    get isDineIn() {
        return this.tableId !== null && this.tableId !== undefined;
    }

    get isOnlineOrder() {
        return this.isOnline === true || this.priceVariant?.includes("ONLINE") || this.source === 'swiggy' || this.source === 'zomato' || false;
    }

    hasStatus(checkStatus) {
        return (this.data?.status?.findIndex(s => s.label === checkStatus) !== -1);
    }

    get ref() {
        return sdk.db.collection("Orders").doc(this.id);
    }

    getOrderSourceColor() {
        const source = this.orderSource;

        if (!source || source.includes("Table")) return "#3498db"; // primary blue
        if (source === "Takeaway") return "#2980b9"; // darker blue

        // Array of colors for different sources
        const colors = [
            "#27ae60", // green
            "#e67e22", // orange
            "#9b59b6", // purple
            "#795548", // brown
            "#e91e63", // pink
            "#009688", // teal
            "#e74c3c", // red
            "#673ab7", // deep purple
            "#ff9800", // orange
        ];

        // Create a simple hash function for the source
        let hash = 0;
        for (let i = 0; i < source.length; i++) {
            hash = ((hash << 5) - hash) + source.charCodeAt(i);
            hash |= 0; // Convert to 32bit integer
        }
        hash = Math.abs(hash);

        return colors[hash % colors.length];
    }

    // Methods
    async updateStatus(statusList) {
        if (!statusList || statusList.length === 0) return;

        const newStatuses = [];
        const now = new Date();

        statusList.forEach(status => {
            if (!this.hasStatus(status)) {
                newStatuses.push({
                    label: status,
                    date: now
                });
            }
        });

        if (newStatuses.length > 0) {
            await this.ref.update({
                currentStatus: newStatuses[newStatuses.length - 1],
                status: sdk.fieldValue.arrayUnion(...newStatuses)
            });

            await this.reload();
        }
    }

    async serveItem(item, served) {
        // Update locally
        item.serveLocally(served);

        // Get current items
        const itemsData = await this._getOrderItems();
        const index = itemsData.findIndex(i => i.pid === item.pid);

        if (index !== -1) {
            itemsData[index].served = served;
            await this.ref.update({ items: itemsData });
            await this.reload();

            // Analytics tracking would be here in a real implementation
            console.log(`Item ${item.pid} served status set to ${served}`);
        }
    }

    async removeItem(item) {
        if (this.totalItems > 1) {
            // Get current items
            const itemsData = await this._getOrderItems();
            const index = itemsData.findIndex(i => i.pid === item.pid);

            if (index !== -1) {
                // Check for qnt property with fallback
                const currentQty = parseInt(itemsData[index].qnt || 1);

                if (currentQty > 1) {
                    // Reduce quantity by 1
                    itemsData[index].qnt = currentQty - 1;
                } else {
                    // Remove the item entirely
                    itemsData.splice(index, 1);
                }

                await this.ref.update({ items: itemsData });
                await this.reload();

                showToast(`🗑️ ${item.title} removed from order`);
                console.log(`Item ${item.pid} removed from order`);
            }
        } else if (UserSession?.seller?.hasPermission("Orders", "Delete")) {
            // Delete the entire order if it's the last item
            await this.ref.delete();
            showToast(`Order deleted`);
        }
    }

    async addItem(item) {
        // Get current items
        const itemsData = await this._getOrderItems();
        const index = itemsData.findIndex(i => i.pid === item.pid);

        if (index !== -1) {
            // Increment quantity of existing item
            itemsData[index].qnt = (itemsData[index].qnt || 1) + 1;

            await this.ref.update({ items: itemsData });
            await this.reload();

            showToast(`🛒 ${item.title} added to order`);
            console.log(`Item ${item.pid} added to order`);
        }
    }

    async setDiscount(discount) {
        if (this.data) {
            this.data.discount = discount;
            await this.ref.update({ discount: discount });

            showToast(`💰 Discount updated to ${discount}`);
            console.log(`Discount updated to ${discount}`);
        }
    }

    async reload() {
        const doc = await this.ref.get();
        if (doc.exists) {
            this.data = doc.data();
        }
    }

    async _getOrderItems() {
        const orderData = await this._getOrderData();
        return orderData.items || [];
    }

    async _getOrderData() {
        const doc = await this.ref.get();
        return doc.exists ? doc.data() : {};
    }
}
