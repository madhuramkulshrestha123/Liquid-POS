import React, { useState, useEffect, useRef, useCallback, useMemo, createElement } from 'react';
import { useOrders } from '../contexts/OrderContext.js';
import { BluetoothPrinting } from '../utils/BluetoothPrinting.js';
import { getModalClasses, getModalOverlayClasses, showToast, ChargesCalculator } from '../utils.js';
import { POS } from '../pages/POS.js';
import ReactDOM from 'react-dom/client';
import { UserSession } from '../utils/UserSession.js';
import { CheckoutSheet } from './CheckoutSheet.js';
import { InventoryItem } from '../models/Product.js';
import { useProfile } from '../contexts/ProfileContext.js';
import { ModalManager } from './ModalManager.js'
import { sdk } from '../sdk.js';

// Add Table Modal Component
export function AddTableModal({ isOpen, onClose, seller }) {
    const [title, setTitle] = useState('');
    const [desc, setDesc] = useState('');
    const [error, setError] = useState(null);
    const [usingModalManager, setUsingModalManager] = useState(false);

    // Reset form when modal opens
    useEffect(() => {
        if (isOpen) {
            setTitle('');
            setDesc('');
            setError(null);

            // Use ModalManager if available
            if (ModalManager && typeof ModalManager.createCenterModal === 'function') {
                setUsingModalManager(true);
                showAddTableModal();
            } else {
                setUsingModalManager(false);
            }
        }
    }, [isOpen]);

    const handleAddTable = async (newTitle, newDesc) => {
        try {
            // Get current tables
            const currentTables = seller?.tables || [];

            // Check if table already exists
            if (currentTables.some(t => t.title === newTitle)) {
                throw new Error('Table already exists');
            }

            // Add new table
            await sdk.profile.update({
                tables: [...currentTables, { title: newTitle, desc: newDesc }]
            });

            // Track analytics if available
            if (sdk.analytics) {
                sdk.analytics.logEvent('add_table', {
                    table_id: newTitle,
                    seller_id: seller?.id
                });
            }

            ModalManager?.showToast('Table added successfully');

            // Trigger UI refresh
            if (refreshTables && typeof refreshTables === 'function') {
                refreshTables();
            }

            return true;
        } catch (err) {
            console.error('Error adding table:', err);
            throw err;
        }
    };

    const showAddTableModal = () => {
        if (!ModalManager || typeof ModalManager.createCenterModal !== 'function') {
            return;
        }

        const content = `
            <div id="add-table-form">
                <div id="error-container" class="mb-4 hidden p-3 bg-red-50 text-red-700 rounded-md"></div>
                <div class="mb-4">
                    <label class="block text-gray-700 mb-2" for="table-title">
                        Title
                    </label>
                    <input
                        type="text"
                        id="table-title"
                        maxlength="4"
                        class="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="eg. T1"
                    />
                    <p class="text-xs text-gray-500 mt-1">Max 4 characters</p>
                </div>

                <div class="mb-6">
                    <label class="block text-gray-700 mb-2" for="table-desc">
                        Description
                    </label>
                    <input
                        type="text"
                        id="table-desc"
                        class="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="eg. Table in the corner"
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
                    Save Table
                </button>
            </div>
        `;

        const modal = ModalManager.createCenterModal({
            id: 'add-table-modal',
            title: 'Add New Table',
            content: content,
            actions: actions,
            onShown: (modalControl) => {
                const titleInput = document.getElementById('table-title');
                const descInput = document.getElementById('table-desc');
                const errorContainer = document.getElementById('error-container');
                const cancelButton = document.getElementById('cancel-add-table');
                const saveButton = document.getElementById('save-add-table');

                if (titleInput && descInput && cancelButton && saveButton) {
                    titleInput.focus();

                    cancelButton.addEventListener('click', () => {
                        modalControl.close();
                        onClose();
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

                        if (!newDesc) {
                            errorContainer.textContent = 'Please enter a description';
                            errorContainer.classList.remove('hidden');
                            return;
                        }

                        try {
                            await handleAddTable(newTitle, newDesc);
                            modalControl.close();
                            onClose();
                        } catch (err) {
                            errorContainer.textContent = err.message || 'Failed to add table. Please try again.';
                            errorContainer.classList.remove('hidden');
                        }
                    });
                }
            }
        });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();

        // Validate form
        if (!title) {
            setError('Please enter a title');
            return;
        }

        if (!desc) {
            setError('Please enter a description');
            return;
        }

        try {
            await handleAddTable(title, desc);
            onClose();
        } catch (err) {
            setError(err.message || 'Failed to add table. Please try again.');
        }
    };

    // If using ModalManager, don't render the default modal
    if (usingModalManager || !isOpen) return null;

    // Fallback to original implementation
    return (
        <div
            className={`fixed inset-0 z-50 flex items-center justify-center p-4 ${isOpen ? 'visible' : 'invisible'}`}
            onClick={onClose}
        >
            <div className="fixed inset-0 bg-black bg-opacity-50"></div>
            <div className="bg-section-bg w-full max-w-md rounded-lg shadow-section overflow-hidden relative z-10" onClick={e => e.stopPropagation()}>
                <div className="px-6 py-4 border-b border-gray-200">
                    <h3 className="text-xl font-semibold text-gray-800">Add New Table</h3>
                </div>

                <form onSubmit={handleSubmit} className="p-6">
                    {error && (
                        <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-md">
                            {error}
                        </div>
                    )}

                    <div className="mb-4">
                        <label className="block text-gray-700 mb-2" htmlFor="title">
                            Title
                        </label>
                        <input
                            type="text"
                            id="title"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            maxLength={4}
                            className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="eg. T1"
                        />
                        <p className="text-xs text-gray-500 mt-1">Max 4 characters</p>
                    </div>

                    <div className="mb-6">
                        <label className="block text-gray-700 mb-2" htmlFor="desc">
                            Description
                        </label>
                        <input
                            type="text"
                            id="desc"
                            value={desc}
                            onChange={(e) => setDesc(e.target.value)}
                            className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="eg. Table in the corner"
                        />
                    </div>

                    <div className="flex justify-end gap-3">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 border rounded-md hover:bg-gray-50"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                        >
                            Save Table
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

// Rename Room Modal Component
export function RenameRoomModal({ isOpen, onClose, tableId, variant, seller }) {
    const [title, setTitle] = useState('');
    const [error, setError] = useState(null);
    const [usingModalManager, setUsingModalManager] = useState(false);

    // Set initial title when modal opens
    useEffect(() => {
        if (isOpen) {
            setTitle(tableId || variant || '');
            setError(null);

            // Use ModalManager if available
            if (ModalManager && typeof ModalManager.createCenterModal === 'function') {
                setUsingModalManager(true);
                showRenameRoomModal();
            } else {
                setUsingModalManager(false);
            }
        }
    }, [isOpen, tableId, variant]);

    // Function to show modal using ModalManager
    const showRenameRoomModal = () => {
        if (!ModalManager || typeof ModalManager.createCenterModal !== 'function') {
            return;
        }

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

        const modal = ModalManager.createCenterModal({
            id: 'rename-room-modal',
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
                        onClose();
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

                            // Trigger UI refresh
                            if (refreshTables && typeof refreshTables === 'function') {
                                refreshTables();
                            }

                            ModalManager.showToast('Renamed successfully');
                            modalControl.close();
                            onClose();
                        } catch (err) {
                            console.error('Error renaming:', err);
                            errorContainer.textContent = 'Failed to rename. Please try again.';
                            errorContainer.classList.remove('hidden');
                        }
                    });
                }
            }
        });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();

        // Validate form
        if (!title) {
            setError('Please enter a title');
            return;
        }

        try {
            if (variant) {
                // Rename price variant
                const vars = seller?.priceVariants || [];
                const index = vars.findIndex(v => v.title === variant);

                if (index === -1) {
                    setError("Can't rename this default room");
                    return;
                }

                const updatedVars = [...vars];
                updatedVars[index] = { title };

                await sdk.profile.update({ priceVariants: updatedVars });
            } else if (tableId) {
                // Rename table
                const tables = seller?.tables || [];
                const index = tables.findIndex(t => t.title === tableId);

                if (index === -1) {
                    setError("Can't rename this table");
                    return;
                }

                const updatedTables = [...tables];
                updatedTables[index] = { ...updatedTables[index], title: newTitle };

                await sdk.profile.update({ tables: updatedTables });
            } else {
                setError("Can't rename room");
                return;
            }

            // Trigger UI refresh
            if (Tables && typeof refreshTables === 'function') {
                refreshTables();
            }

            showToast('Renamed successfully');
            onClose();
        } catch (err) {
            console.error('Error renaming:', err);
            setError('Failed to rename. Please try again.');
        }
    };

    // If using ModalManager, don't render the default modal
    if (usingModalManager || !isOpen) return null;

    // Fallback to original implementation
    return (
        <div
            className={`fixed inset-0 z-50 flex items-center justify-center p-4 ${isOpen ? 'visible' : 'invisible'}`}
            onClick={onClose}
        >
            <div className="fixed inset-0 bg-black bg-opacity-50"></div>
            <div className="bg-section-bg w-full max-w-md rounded-lg shadow-section overflow-hidden relative z-10" onClick={e => e.stopPropagation()}>
                <div className="px-6 py-4 border-b border-gray-200">
                    <h3 className="text-xl font-semibold text-gray-800">Rename Table</h3>
                </div>

                <form onSubmit={handleSubmit} className="p-6">
                    {error && (
                        <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-md">
                            {error}
                        </div>
                    )}

                    <div className="mb-6">
                        <label className="block text-gray-700 mb-2" htmlFor="title">
                            Title
                        </label>
                        <input
                            type="text"
                            id="title"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="eg. T1"
                        />
                    </div>

                    <div className="flex justify-end gap-3">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 border rounded-md hover:bg-gray-50"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                        >
                            Save
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

// Profile Menu Component
export function ProfileMenu({ isOpen, onClose, seller }) {
    const { downloadQr } = useProfile ? useProfile() : { downloadQr: () => { } };
    const [showProfileEditor, setShowProfileEditor] = useState(false);

    if (!isOpen) return null;

    // If profile editor is shown, render the ProfilePage component
    if (showProfileEditor) {
        return (
            <div className="fixed inset-0 z-50 bg-black bg-opacity-50" onClick={() => setShowProfileEditor(false)}>
                <div className="absolute right-0 top-0 h-full w-full md:w-2/3 lg:w-1/2 bg-white shadow-lg overflow-y-auto" onClick={e => e.stopPropagation()}>
                    <div className="p-4">
                        <div className="flex justify-between items-center mb-4">
                            <h2 className="text-xl font-semibold">Edit Profile</h2>
                            <button
                                className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-50 hover:bg-gray-100 transition-colors"
                                onClick={() => setShowProfileEditor(false)}
                            >
                                <i className="ph ph-x text-lg text-gray-600" />
                            </button>
                        </div>
                        <ProfilePage inModal={true} onClose={() => setShowProfileEditor(false)} />
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="fixed inset-0 z-50" onClick={onClose}>
            <div className="fixed inset-0 bg-black bg-opacity-50"></div>
            <div className="absolute top-16 right-4 mt-2 w-64 bg-section-bg rounded-lg shadow-section overflow-hidden" onClick={e => e.stopPropagation()}>
                <div className="p-6">
                    {/* Modern Header with just close button */}
                    <div className="flex justify-end mb-6">
                        <button className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-50 hover:bg-gray-100 transition-colors" onClick={onClose}>
                            <i className="ph ph-x text-lg text-gray-600" />
                        </button>
                    </div>

                    {/* Content Container with gradient background */}
                    <div className="space-y-8">
                        {/* Avatar and Basic Info with gradient background */}
                        <div className="relative text-center px-4 py-6 rounded-2xl bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50">
                            <div className="inline-block relative mb-4">
                                <div className="w-24 h-24 rounded-full bg-white flex items-center justify-center overflow-hidden border-2 border-white ring-4 ring-white/50 shadow-lg">
                                    {seller?.avatar ? (
                                        <img src={seller.avatar} alt={seller?.businessName} className="w-full h-full object-cover" />
                                    ) : (
                                        <i className="ph ph-storefront text-3xl text-gray-400" />
                                    )}
                                </div>
                            </div>
                            <h4 className="text-lg font-semibold text-gray-900">
                                {seller?.businessName || 'Loading...'}
                            </h4>
                            {seller?.phone && (
                                <p className="text-sm text-gray-500 mt-1 flex items-center justify-center gap-1">
                                    <i className="ph ph-phone text-base" />
                                    {seller.phone}
                                </p>
                            )}
                        </div>

                        {/* Info Cards */}
                        <div className="space-y-4">
                            {seller?.address && (
                                <div className="bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-50 p-4 rounded-xl border border-emerald-100/20">
                                    <div className="flex items-start gap-3">
                                        <div className="w-8 h-8 rounded-full bg-white/80 flex items-center justify-center flex-shrink-0 shadow-sm">
                                            <i className="ph ph-map-pin text-emerald-600" />
                                        </div>
                                        <div>
                                            <h5 className="text-sm font-medium text-gray-900 mb-1">Store Address</h5>
                                            <p className="text-sm text-gray-600 leading-relaxed">{seller.address}</p>
                                        </div>
                                    </div>
                                </div>
                            )}

                            <div className="bg-gradient-to-br from-blue-50 via-indigo-50 to-violet-50 p-4 rounded-xl border border-blue-100/20">
                                <div className="flex items-start gap-3">
                                    <div className="w-8 h-8 rounded-full bg-white/80 flex items-center justify-center flex-shrink-0 shadow-sm">
                                        <i className="ph ph-globe text-blue-600" />
                                    </div>
                                    <div className="flex-1">
                                        <div className="flex items-center justify-between mb-1">
                                            <h5 className="text-sm font-medium text-gray-900">Store URL</h5>
                                            <button
                                                className="text-blue-600 hover:text-blue-700 text-sm font-medium"
                                                onClick={() => {
                                                    const url = `https://${seller?.username}.shopto.store`;
                                                    navigator.clipboard.writeText(url);
                                                    showToast('URL copied to clipboard', 'success');
                                                }}
                                            >
                                                Copy
                                            </button>
                                        </div>
                                        <p className="text-sm text-gray-600 font-mono break-all">
                                            {`https://${seller?.username}.shopto.store`}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Action Buttons */}
                        <div className="space-y-3 pt-2">
                            <button
                                className="w-full px-4 py-2.5 bg-gradient-to-r from-blue-500 to-indigo-500 text-white rounded-xl hover:from-blue-600 hover:to-indigo-600 transition-all flex items-center justify-center gap-2 font-medium shadow-sm"
                                onClick={() => downloadQr()}
                            >
                                <i className="ph ph-qr-code text-lg" />
                                Get Store QR Code
                            </button>
                            <button
                                className="w-full px-4 py-2.5 bg-gradient-to-r from-gray-100 to-gray-50 text-gray-700 rounded-xl hover:from-gray-200 hover:to-gray-100 transition-all flex items-center justify-center gap-2 font-medium"
                                onClick={() => setShowProfileEditor(true)}
                            >
                                <i className="ph ph-user-circle text-lg" />
                                Edit Profile
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

// Add Inventory Modal Component
export function AddInventoryModal({ isOpen, onClose, onSave, editItem = null }) {
    const [formData, setFormData] = useState({
        name: '',
        quantity: '',
        unit: 'kg',
        minQuantity: ''
    });

    // Initialize form data when editItem changes
    useEffect(() => {
        if (editItem) {
            setFormData({
                name: editItem.name || '',
                quantity: editItem.quantity || '',
                unit: editItem.unit || 'kg',
                minQuantity: editItem.minQuantity || ''
            });
        } else {
            setFormData({
                name: '',
                quantity: '',
                unit: 'kg',
                minQuantity: ''
            });
        }
    }, [editItem]);

    const units = ['kg', 'gm', 'ltr', 'ml', 'pc'];

    if (!isOpen) return null;

    return (
        <div
            className={`fixed inset-0 z-50 flex items-center justify-center p-4 ${isOpen ? 'visible' : 'invisible'}`}
            onClick={onClose}
        >
            <div className="fixed inset-0 bg-black bg-opacity-50"></div>
            <div className="bg-section-bg w-full max-w-md rounded-lg shadow-section overflow-hidden relative z-10 p-6" onClick={e => e.stopPropagation()}>
                {/* Modal Header */}
                <div className="flex items-center justify-between mb-6">
                    <h3 className="text-xl font-semibold text-gray-800">
                        {editItem ? 'Edit Inventory Item' : 'Add New Item'}
                    </h3>
                    <button className="p-2 hover:bg-gray-100 rounded-full" onClick={onClose}>
                        <i className="ph ph-x text-gray-600" />
                    </button>
                </div>
                {/* Form */}
                <div className="space-y-4">
                    {/* Name Input */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Item Name
                        </label>
                        <input
                            type="text"
                            value={formData.name}
                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
                            placeholder="Enter item name"
                        />
                    </div>
                    {/* Quantity and Unit */}
                    <div className="flex gap-4">
                        <div className="flex-1">
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Quantity
                            </label>
                            <input
                                type="number"
                                value={formData.quantity}
                                onChange={(e) => setFormData({ ...formData, quantity: e.target.value })}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
                                placeholder="Enter quantity"
                                min="0"
                            />
                        </div>
                        <div className="w-32">
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Unit
                            </label>
                            <select
                                value={formData.unit}
                                onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
                            >
                                {units.map(unit => (
                                    <option key={unit} value={unit}>{unit}</option>
                                ))}
                            </select>
                        </div>
                    </div>
                    {/* Min Quantity */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Minimum Quantity
                        </label>
                        <input
                            type="number"
                            value={formData.minQuantity}
                            onChange={(e) => setFormData({ ...formData, minQuantity: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
                            placeholder="Enter minimum quantity"
                            min="0"
                        />
                    </div>
                </div>
                {/* Action Buttons */}
                <div className="flex justify-end gap-3 mt-6">
                    <button
                        className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                        onClick={onClose}
                    >
                        Cancel
                    </button>
                    <button
                        className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
                        onClick={() => {
                            if (!formData.name || formData.quantity === '' || formData.minQuantity === '') {
                                alert('Please fill all required fields');
                                return;
                            }
                            onSave({
                                ...formData,
                                quantity: Number(formData.quantity),
                                minQuantity: Number(formData.minQuantity),
                                lastUpdated: new Date().toISOString()
                            });
                        }}
                    >
                        {editItem ? 'Update' : 'Add'}
                    </button>
                </div>
            </div>
        </div>
    );
}

// OrderRoom Modal Component
export function OrderRoom({ isOpen, onClose, tableId, variant, orderStatus = "KITCHEN", seller }) {
    // Get order data and methods directly from OrderContext
    const {
        getOrdersForSource,
        isLoading: ordersLoading,
        refreshCompletedOrders
    } = useOrders ? useOrders() : {
        getOrdersForSource: () => [],
        isLoading: true,
        refreshCompletedOrders: () => { }
    };

    // Get orders directly from context without maintaining separate state
    const orders = getOrdersForSource(tableId, variant, orderStatus);

    // State to track printer connection status
    const [printerConnected, setPrinterConnected] = useState(
        BluetoothPrinting ? BluetoothPrinting.connected : false
    );
    const [connectingPrinter, setConnectingPrinter] = useState(false);
    const [managedPrinters, setManagedPrinters] = useState([]);
    const [selectedPrinter, setSelectedPrinter] = useState(null);
    const [showPrinterDropdown, setShowPrinterDropdown] = useState(false);
    const printerDropdownRef = useRef(null);

    // Load managed printers
    useEffect(() => {
        if (BluetoothPrinting) {
            const printers = BluetoothPrinting.getSavedPrinters() || [];
            setManagedPrinters(printers);

            // Set the active printer (connected, default, or first available)
            const connectedPrinter = BluetoothPrinting.device ?
                printers.find(p => p.deviceId === BluetoothPrinting.device.id) : null;

            const activeId = BluetoothPrinting.getActivePrinterId();
            const activePrinter = printers.find(p => p.id === activeId);

            const defaultPrinter = printers.find(p => p.isDefault);

            setSelectedPrinter(connectedPrinter || activePrinter || defaultPrinter || (printers.length > 0 ? printers[0] : null));

            // Try to reconnect to the saved printer if we have one and we're not already connected
            if (isOpen && !BluetoothPrinting.connected && BluetoothPrinting.lastConnectedDevice) {
                tryReconnectToPrinter();
            }
        }
    }, [isOpen]);

    // Attempt to reconnect to the last used printer when the modal opens
    const tryReconnectToPrinter = useCallback(async () => {
        if (!BluetoothPrinting || BluetoothPrinting.connected) return;

        try {
            setConnectingPrinter(true);
            console.log('OrderRoom: Attempting to reconnect to saved printer...');

            // First try silent reconnect without showing any message to avoid UI clutter
            const reconnected = await BluetoothPrinting.attemptSilentReconnect();

            if (reconnected) {
                setPrinterConnected(true);
                // Show success message only when reconnection is successful
                if (ModalManager && typeof ModalManager.showToast === 'function') {
                    ModalManager.showToast(`Printer ready`, { type: "success" });
                } else {
                    showToast(`Printer ready`, "success");
                }
            }
        } catch (error) {
            console.error('Error reconnecting to printer:', error);
            // Don't show error toast for reconnection attempts to reduce notification spam
        } finally {
            setConnectingPrinter(false);
        }
    }, []);

    // Debug logging
    useEffect(() => {
        console.log(`[OrderRoom] Component mounted/updated for ${tableId ? `Table ${tableId}` : variant || 'Default'}`);
        console.log(`[OrderRoom] Received ${orders.length} orders with status "${orderStatus}"`);

        if (orders.length > 0) {
            console.log(`[OrderRoom] First few orders:`, orders.slice(0, 3).map(o => ({
                id: o.id,
                tableId: o.tableId || null,
                priceVariant: o.priceVariant || null,
                status: o.currentStatus?.label
            })));
        } else {
            console.log(`[OrderRoom] No orders found. This might indicate a problem with filtering or data.`);
        }
    }, [orders, tableId, variant, orderStatus]);

    // Update printer connection status when BluetoothPrinting state changes
    useEffect(() => {
        if (BluetoothPrinting) {
            const checkConnectionStatus = () => {
                setPrinterConnected(BluetoothPrinting.connected);
            };

            // Initial check
            checkConnectionStatus();

            // Set up an interval to periodically check printer connection status
            const interval = setInterval(checkConnectionStatus, 2000);

            return () => clearInterval(interval);
        }
    }, [isOpen]);

    // Handle clicks outside of printer dropdown
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (printerDropdownRef.current && !printerDropdownRef.current.contains(event.target)) {
                setShowPrinterDropdown(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, []);

    // Keep the disconnect function when closing the room
    useEffect(() => {
        if (!isOpen && printerConnected && BluetoothPrinting) {
            // We don't need to actually disconnect the printer, as we want to maintain
            // the connection for future use. Just update the UI state.
            setPrinterConnected(BluetoothPrinting.connected);
        }
    }, [isOpen, printerConnected]);

    // Calculate totals for progress bar
    const totalItems = useMemo(() => {
        return orders.reduce((sum, order) => {
            const itemCount = order.items?.reduce((itemSum, item) => itemSum + (item.quantity || item.qnt || 1), 0) || 0;
            return sum + itemCount;
        }, 0);
    }, [orders]);

    const servedItems = useMemo(() => {
        return orders.reduce((sum, order) => {
            const servedCount = order.items?.filter(item => item.served)
                .reduce((itemSum, item) => itemSum + (item.quantity || item.qnt || 1), 0) || 0;
            return sum + servedCount;
        }, 0);
    }, [orders]);

    const progressPercent = useMemo(() => {
        const progress = totalItems > 0 ? servedItems / totalItems : 0;
        return Math.round(progress * 100);
    }, [totalItems, servedItems]);

    const [error, setError] = useState(null);
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
    const menuRef = useRef(null);
    const dialogRef = useRef(null);
    const [isClosing, setIsClosing] = useState(false);

    // Check for mobile/desktop on resize
    useEffect(() => {
        const handleResize = () => {
            setIsMobile(window.innerWidth < 768);
        };

        window.addEventListener('resize', handleResize);
        return () => {
            window.removeEventListener('resize', handleResize);
        };
    }, []);

    // Add click event listener to close menu when clicking outside
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (menuRef.current && !menuRef.current.contains(event.target)) {
                setIsMenuOpen(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, []);

    // Add swipe gesture for mobile
    useEffect(() => {
        if (!isOpen || !dialogRef.current) return;

        let startX, startY;
        const handleTouchStart = (e) => {
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
        };

        const handleTouchMove = (e) => {
            if (!startX || !startY) return;

            const currentX = e.touches[0].clientX;
            const currentY = e.touches[0].clientY;
            const diffX = startX - currentX;
            const diffY = startY - currentY;

            // Detect horizontal swipe (for desktop)
            if (Math.abs(diffX) > Math.abs(diffY) && diffX < -50 && !isMobile) {
                handleClose();
            }

            // Detect vertical swipe down (for mobile)
            if (Math.abs(diffY) > Math.abs(diffX) && diffY < -50 && isMobile) {
                handleClose();
            }
        };

        const element = dialogRef.current;
        element.addEventListener('touchstart', handleTouchStart);
        element.addEventListener('touchmove', handleTouchMove);

        return () => {
            element.removeEventListener('touchstart', handleTouchStart);
            element.removeEventListener('touchmove', handleTouchMove);
        };
    }, [isOpen, isMobile]);

    // Handle printer selection
    const handlePrinterSelect = (printer) => {
        if (!printer) return;

        setSelectedPrinter(printer);
        setShowPrinterDropdown(false);

        if (BluetoothPrinting) {
            // Set as active printer for printing operations
            BluetoothPrinting.setActivePrinterId(printer.id);

            // If we need to connect to the selected printer
            if (!printerConnected && printer.deviceId) {
                setConnectingPrinter(true);

                // Try to connect to this specific printer using its deviceId
                BluetoothPrinting.lastConnectedDevice = {
                    id: printer.deviceId,
                    name: printer.name || printer.deviceName
                };

                BluetoothPrinting.connect()
                    .then(() => {
                        setPrinterConnected(true);
                        if (ModalManager && typeof ModalManager.showToast === 'function') {
                            ModalManager.showToast(`Connected to ${printer.name}`, { type: "success" });
                        } else {
                            showToast(`Connected to ${printer.name}`, "success");
                        }
                    })
                    .catch(error => {
                        console.error("Error connecting to printer:", error);
                        // Only show error messages for non-cancellation errors
                        if (error.name !== "NotFoundError" &&
                            !error.message.includes("Device selection cancelled") &&
                            !error.message.includes("cancelled by user") &&
                            !error.message.includes("No printer selected")) {
                            if (ModalManager && typeof ModalManager.showToast === 'function') {
                                ModalManager.showToast("Error connecting to printer", { type: "error" });
                            } else {
                                showToast("Error connecting to printer", "error");
                            }
                        }
                    })
                    .finally(() => {
                        setConnectingPrinter(false);
                    });
            }
        }
    };

    // Handle smooth closing animation
    const handleClose = () => {
        setIsClosing(true);
        setTimeout(() => {
            setIsClosing(false);
            onClose();
        }, 300); // Match this with the CSS transition duration
    };

    // We've removed the loadOrders function since we're now directly using data from context
    // The context will automatically update when orders change

    const handleAddNewOrder = () => {
        // Check if POS component is available
        if (!POS) {
            console.error("POS component is not defined");
            showToast("Cannot open POS: component not available", "error");
            return;
        }

        // Create a container for the POS component
        const posContainer = document.createElement('div');
        posContainer.id = 'pos-container';
        posContainer.className = 'fixed inset-0 z-50';
        document.body.appendChild(posContainer);

        try {
            // Create a root element for React 18
            const root = ReactDOM.createRoot(posContainer);

            // Render the POS component
            root.render(
                createElement(POS, {
                    title: "New Order",
                    tableId: tableId,
                    variant: variant,
                    onClose: () => {
                        // Unmount and clean up
                        root.unmount();
                        if (document.body.contains(posContainer)) {
                            document.body.removeChild(posContainer);
                        }
                        // No need to explicitly refresh orders, context will update automatically
                    }
                })
            );
        } catch (error) {
            console.error("Error rendering POS:", error);
            if (document.body.contains(posContainer)) {
                document.body.removeChild(posContainer);
            }
            showToast("Failed to open POS", "error");
        }
    };

    const handleShowQR = () => {
        // Download QR code for the table (equivalent to Usr.seller!.downloadQr(tableId: widget.tableId))
        if (seller && typeof seller.downloadQr === 'function') {
            seller.downloadQr(tableId);
        } else {
            // Fallback if seller.downloadQr is not available
            const storeLink = seller?.getStoreLink ? seller.getStoreLink() : `https://${seller?.username || 'store'}.shopto.store`;
            const url = tableId ? `${storeLink}/getQR?id=${tableId}` : `${storeLink}/getQR`;
            window.open(url, '_blank');
        }
        setIsMenuOpen(false);
    };

    const confirmDelete = () => {
        // Confirm before deleting (equivalent to confirmDialog in Flutter)
        confirmDialog({
            title: "Confirm Delete",
            content: `Are you sure you want to delete ${tableId ? `table ${tableId}` : variant}?`,
            confirmText: "DELETE",
            onConfirm: async () => {
                try {
                    if (tableId && seller && typeof seller.removeTable === 'function') {
                        await seller.removeTable(tableId);
                        showToast('Table deleted successfully');
                        handleClose(); // Use handleClose instead of onClose directly
                    } else {
                        showToast('Delete functionality not available');
                    }
                } catch (err) {
                    console.error('Error deleting table:', err);
                    showToast('Failed to delete table');
                }
            }
        });
        setIsMenuOpen(false);
    };

    // Render the no orders widget (equivalent to noOrderWidget in Flutter)
    const renderNoOrdersWidget = () => {
        console.log(`[OrderRoom] No orders for ${tableId ? `Table ${tableId}` : variant || 'Default'}`);
        console.log(`[OrderRoom] Current orderStatus filter: "${orderStatus}"`);

        return (
            <div className="flex flex-col items-center justify-center h-full py-10 text-center">
                <div className="w-24 h-24 bg-red-50 rounded-full flex items-center justify-center mb-5">
                    <i className="ph ph-shopping-bag text-4xl text-red-400"></i>
                </div>
                <h3 className="text-2xl font-medium text-gray-700 mb-2">No Orders Yet</h3>
                <p className="text-gray-500 max-w-sm mb-8">Add new orders using the button below</p>
            </div>
        );
    };

    // Render the context menu (equivalent to contextMenu in Flutter)
    const renderContextMenu = () => {
        if (!isMenuOpen) return null;

        return (
            <div
                ref={menuRef}
                className="absolute right-0 top-12 w-52 bg-white rounded-lg shadow-lg border border-gray-200 overflow-hidden z-50"
            >
                <div className="py-1">
                    {/* Removed printer management/disconnect button */}
                    <button
                        className="w-full text-left px-4 py-3 text-gray-700 hover:bg-gray-50 flex items-center gap-3"
                        onClick={() => {
                            setIsMenuOpen(false);
                            handleShowQR();
                        }}
                    >
                        <i className="ph ph-qr-code text-red-500"></i>
                        <span>Show QR Code</span>
                    </button>

                    <button
                        className="w-full text-left px-4 py-3 text-gray-700 hover:bg-gray-50 flex items-center gap-3"
                        onClick={() => {
                            if (confirm(`Are you sure you want to delete all orders for ${tableId || variant}?`)) {
                                confirmDelete();
                            }
                            setIsMenuOpen(false);
                        }}
                    >
                        <i className="ph ph-trash text-red-500"></i>
                        <span>Clear All Orders</span>
                    </button>

                    <button
                        className="w-full text-left px-4 py-3 text-gray-700 hover:bg-gray-50 flex items-center gap-3"
                        onClick={() => {
                            setIsMenuOpen(false);
                            showRenameRoomModal(tableId, variant);
                        }}
                    >
                        <i className="ph ph-pencil-simple text-red-500"></i>
                        <span>Rename {tableId ? 'Table' : 'Channel'}</span>
                    </button>

                    {tableId && (
                        <button
                            className="w-full text-left px-4 py-3 text-gray-700 hover:bg-gray-50 flex items-center gap-3"
                            onClick={() => {
                                if (confirm(`Are you sure you want to delete table ${tableId}?`)) {
                                    deleteTable(tableId);
                                    handleClose();
                                }
                                setIsMenuOpen(false);
                            }}
                        >
                            <i className="ph ph-trash text-red-500"></i>
                            <span>Delete Table</span>
                        </button>
                    )}
                </div>
            </div>
        );
    };

    const deleteTable = async (tableId) => {
        try {
            // Get current tables from seller
            const currentTables = seller?.tables || [];

            // Remove the table
            const updatedTables = currentTables.filter(table => table.title !== tableId);

            // Update seller document in Firestore
            await sdk.profile.update({
                tables: updatedTables
            });

            showToast('Table removed successfully');
            handleClose();
        } catch (err) {
            console.error('Error removing table:', err);
            showToast('Failed to remove table. Please try again.');
        }
    };

    const showRenameRoomModal = (tableId, variant) => {
        if (ModalManager && typeof ModalManager.createCenterModal === 'function') {
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

            const modal = ModalManager.createCenterModal({
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

                            if (!newTitle) {
                                errorContainer.textContent = 'Please enter a title';
                                errorContainer.classList.remove('hidden');
                                return;
                            }

                            try {
                                if (variant) {
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
                                }

                                // Trigger UI refresh
                                if (refreshTables && typeof refreshTables === 'function') {
                                    refreshTables();
                                }

                                ModalManager.showToast('Renamed successfully');
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

    if (!isOpen) return null;

    // Use the utility function for modal classes
    const dialogClasses = getModalClasses({
        isMobile,
        isClosing
    });

    // Use utility function for overlay classes
    const overlayClasses = getModalOverlayClasses(isClosing);

    return (
        <div
            className={`fixed inset-0 z-50 ${isOpen ? 'visible' : 'invisible'}`}
            onClick={onClose}
        >
            <div className="fixed inset-0 bg-black bg-opacity-50"></div>
            <div className="absolute right-0 top-0 h-full w-full md:w-2/3 lg:w-1/2 bg-section-bg shadow-section overflow-y-auto" onClick={e => e.stopPropagation()}>
                <div className="sticky top-0 bg-white border-b z-10">
                    <div className="p-4 flex items-center justify-between">
                        <h2 className="text-xl font-semibold">{variant || `Table ${tableId}`}</h2>
                        <div className="flex items-center gap-3">
                            {BluetoothPrinting && BluetoothPrinting.isSupported() && (
                                <div className="relative" ref={printerDropdownRef}>
                                    <div
                                        className={`flex items-center gap-2 px-2 py-1 rounded-lg cursor-pointer ${printerConnected ? 'bg-green-50 text-green-600' : 'bg-gray-50 text-gray-600'} hover:bg-opacity-80 transition-colors`}
                                        onClick={() => setShowPrinterDropdown(!showPrinterDropdown)}
                                        title={printerConnected ? (selectedPrinter?.name || 'Printer connected') : 'Select printer'}
                                    >
                                        <i className="ph ph-printer text-xl"></i>
                                        {/* Show selected printer name or fallback */}
                                        <span className="max-w-[120px] truncate text-sm font-medium">
                                            {selectedPrinter?.name || (printerConnected ? 'Connected' : 'No Printer')}
                                        </span>
                                        {connectingPrinter ? (
                                            <div className="w-3 h-3 border-2 border-t-transparent border-current rounded-full animate-spin"></div>
                                        ) : (
                                            <i className={`ph ph-caret-${showPrinterDropdown ? 'up' : 'down'} text-xs`}></i>
                                        )}
                                    </div>

                                    {/* Printer Dropdown */}
                                    {showPrinterDropdown && (
                                        <div className="absolute right-0 top-full mt-1 bg-white rounded-lg shadow-lg border border-gray-200 z-20 w-56">
                                            <div className="p-2 border-b border-gray-100">
                                                <div className="text-sm font-medium text-gray-800">Select Printer</div>
                                            </div>
                                            <div className="max-h-56 overflow-y-auto">
                                                {managedPrinters.length > 0 ? (
                                                    <>
                                                        {managedPrinters.map(printer => (
                                                            <div
                                                                key={printer.id}
                                                                className={`px-3 py-2 flex items-center cursor-pointer ${selectedPrinter?.id === printer.id ? 'bg-red-50 text-red-500' : 'hover:bg-gray-50'}`}
                                                                onClick={() => handlePrinterSelect(printer)}
                                                            >
                                                                <i className={`ph ph-printer mr-2 ${printer.isDefault ? 'text-red-500' : 'text-gray-500'}`}></i>
                                                                <div className="flex-1 overflow-hidden">
                                                                    <div className="text-sm font-medium truncate">{printer.name}</div>
                                                                    {printer.isDefault && <div className="text-xs text-gray-500">Default</div>}
                                                                </div>
                                                                {selectedPrinter?.id === printer.id && <i className="ph ph-check text-red-500"></i>}
                                                            </div>
                                                        ))}
                                                        <div className="border-t border-gray-100 p-2">
                                                            <button
                                                                className="w-full text-xs text-left px-3 py-2 text-red-500 hover:bg-gray-50 rounded flex items-center gap-2"
                                                                onClick={() => {
                                                                    setShowPrinterDropdown(false);
                                                                    BluetoothPrinting.connect()
                                                                        .then(() => {
                                                                            setPrinterConnected(true);
                                                                            // Refresh printers list
                                                                            const printers = BluetoothPrinting.getSavedPrinters() || [];
                                                                            setManagedPrinters(printers);
                                                                        });
                                                                }}
                                                            >
                                                                <i className="ph ph-plus-circle"></i>
                                                                <span>Add New Printer</span>
                                                            </button>
                                                        </div>
                                                    </>
                                                ) : (
                                                    <div>
                                                        <div className="px-3 py-3 text-center text-gray-500 text-sm">No printers configured</div>
                                                        <div className="border-t border-gray-100 p-2">
                                                            <button
                                                                className="w-full text-xs text-left px-3 py-2 text-red-500 hover:bg-gray-50 rounded flex items-center gap-2"
                                                                onClick={() => {
                                                                    setShowPrinterDropdown(false);
                                                                    BluetoothPrinting.connect()
                                                                        .then(() => {
                                                                            setPrinterConnected(true);
                                                                            // Refresh printers list
                                                                            const printers = BluetoothPrinting.getSavedPrinters() || [];
                                                                            setManagedPrinters(printers);
                                                                        });
                                                                }}
                                                            >
                                                                <i className="ph ph-plus-circle"></i>
                                                                <span>Connect Printer</span>
                                                            </button>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                            <div className="relative" ref={menuRef}>
                                <button
                                    className="p-2 hover:bg-gray-100 rounded-full"
                                    onClick={() => setIsMenuOpen(!isMenuOpen)}
                                    title="Menu"
                                >
                                    <i className="ph ph-dots-three-vertical text-xl text-gray-600"></i>
                                </button>
                                {renderContextMenu()}
                            </div>
                            <button
                                onClick={handleClose}
                                className="p-2 hover:bg-gray-100 rounded-full"
                                title="Close"
                            >
                                <i className="ph ph-x text-xl text-gray-600"></i>
                            </button>
                        </div>
                    </div>

                    {/* Progress bar for all orders */}
                    {orders.length > 0 && (
                        <div className="px-4 pb-3 flex items-center justify-between">
                            <div className="flex items-center gap-2 text-sm text-gray-600">
                                <span>{servedItems}/{totalItems} items served</span>
                            </div>
                            <div className="text-sm font-medium text-gray-700">
                                {progressPercent}% complete
                            </div>
                        </div>
                    )}
                </div>

                <div className="flex flex-col h-[calc(100%-70px)]">
                    {ordersLoading ? (
                        <div className="p-4 text-center flex-1 flex flex-col items-center justify-center">
                            <div className="animate-spin inline-block w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full" />
                            <p className="mt-2 text-gray-600">Loading orders...</p>
                        </div>
                    ) : error ? (
                        <div className="p-4 text-center flex-1 flex flex-col items-center justify-center">
                            <div className="bg-red-50 text-red-600 p-4 rounded-lg max-w-md">
                                <i className="ph ph-warning-circle text-2xl mb-2"></i>
                                <p>{error}</p>
                            </div>
                        </div>
                    ) : orders.length === 0 ? (
                        <div className="flex-1 flex flex-col">
                            <div className="flex-1 flex items-center justify-center">
                                {renderNoOrdersWidget()}
                            </div>
                            <div className="p-4 mt-auto">
                                <button
                                    className="w-full py-3 px-4 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors flex items-center justify-center gap-2"
                                    onClick={handleAddNewOrder}
                                >
                                    <i className="ph ph-plus-circle text-xl"></i>
                                    <span>Add New Order</span>
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="flex flex-col">
                            <div className="space-y-6 flex-1 overflow-y-auto p-4">
                                {orders.map(order => {
                                    // Create an MOrder-like object with the necessary methods
                                    const mOrder = {
                                        ...order,
                                        id: order.id,
                                        billNo: order.billNo,
                                        items: order.items || [],
                                        date: order.date,
                                        servedItems: order.items?.filter(item => item.served).length || 0,
                                        totalItems: order.items?.length || 0,
                                        subTotal: order.items?.reduce((sum, item) => sum + ((item.price || 0) * (item.qnt || 1)), 0) || 0,
                                        // Add methods that OrderView component expects
                                        serveItem: async (item, served) => {
                                            try {
                                                const orderRef = sdk.db.collection("Orders").doc(order.id);
                                                const orderDoc = await orderRef.get();
                                                if (!orderDoc.exists) throw new Error('Order not found');

                                                const orderData = orderDoc.data();
                                                const updatedItems = orderData.items.map(i => {
                                                    if (i.pid === item.pid) {
                                                        return { ...i, served: served };
                                                    }
                                                    return i;
                                                });

                                                await orderRef.update({ items: updatedItems });
                                                return true;
                                            } catch (error) {
                                                console.error("Error updating serve status:", error);
                                                throw error;
                                            }
                                        },
                                        addItem: async (item) => {
                                            try {
                                                const orderRef = sdk.db.collection("Orders").doc(order.id);
                                                const orderDoc = await orderRef.get();
                                                if (!orderDoc.exists) throw new Error('Order not found');

                                                const orderData = orderDoc.data();
                                                const updatedItems = orderData.items.map(i => {
                                                    if (i.pid === item.pid) {
                                                        const newQnt = (i.qnt || 1) + 1;
                                                        return { ...i, qnt: newQnt };
                                                    }
                                                    return i;
                                                });

                                                await orderRef.update({ items: updatedItems });
                                                return true;
                                            } catch (error) {
                                                console.error("Error adding item:", error);
                                                throw error;
                                            }
                                        },
                                        removeItem: async (item) => {
                                            try {
                                                const orderRef = sdk.db.collection("Orders").doc(order.id);
                                                const orderDoc = await orderRef.get();
                                                if (!orderDoc.exists) throw new Error('Order not found');

                                                const orderData = orderDoc.data();

                                                // Find the item in the current items array
                                                const itemIndex = orderData.items.findIndex(i => i.pid === item.pid);
                                                if (itemIndex === -1) {
                                                    throw new Error('Item not found in order');
                                                }

                                                // Get current quantity - standardize on qnt property
                                                const currentQty = parseInt(orderData.items[itemIndex].qnt || 1);

                                                // If quantity is 1, remove the item completely
                                                if (currentQty <= 1) {
                                                    // Remove the item from the items array
                                                    const updatedItems = orderData.items.filter(i => i.pid !== item.pid);
                                                    // Update the order with the modified items array
                                                    await orderRef.update({ items: updatedItems });
                                                    showToast(`${item.title} removed from order`);
                                                } else {
                                                    // Decrease quantity by 1
                                                    const updatedItems = [...orderData.items];
                                                    updatedItems[itemIndex] = {
                                                        ...updatedItems[itemIndex],
                                                        qnt: currentQty - 1
                                                    };
                                                    // Update the order with the modified items array
                                                    await orderRef.update({ items: updatedItems });
                                                    showToast(`Decreased ${item.title} quantity by 1`);
                                                }
                                            } catch (err) {
                                                console.error('Error updating item quantity:', err);
                                                showToast('Failed to update item quantity', 'error');
                                            }
                                        }
                                    };

                                    return (
                                        <OrderView
                                            key={order.id}
                                            order={mOrder}
                                            tableId={tableId}
                                            variant={variant}
                                            refreshOrders={refreshCompletedOrders}
                                        />
                                    );
                                })}
                            </div>
                            <div className="p-4 mt-auto border-t sticky bottom-0 bg-white">
                                <button
                                    className="w-full py-3 px-4 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors flex items-center justify-center gap-2"
                                    onClick={handleAddNewOrder}
                                >
                                    <i className="ph ph-plus-circle text-xl"></i>
                                    <span>Add New Order</span>
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

// OrderView Component
export function OrderView({ order, tableId, variant, refreshOrders }) {
    // Calculate served items
    const servedItems = order.items?.filter(item => item.served).length || 0;
    const totalItems = order.items?.length || 0;
    const progressPercent = totalItems > 0 ? (servedItems / totalItems) * 100 : 0;
    const [showContextMenu, setShowContextMenu] = useState(false);
    const menuRef = useRef(null);

    // Close context menu when clicking outside
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (menuRef.current && !menuRef.current.contains(event.target)) {
                setShowContextMenu(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, []);

    // Handle instructions change
    const handleInstructionsChange = async (value) => {
        try {
            // Update the order in Firestore
            await sdk.db.collection("Orders").doc(order.id).update({
                instructions: value
            });
        } catch (error) {
            console.error("Error updating instructions:", error);
        }
    };

    // Format date using the patterns from DateModifiers extension
    const formatTinyDateTime = (date) => {
        if (!date) return 'Just now';

        try {
            const orderDate = new Date(date);

            // Check if date is valid
            if (isNaN(orderDate.getTime())) {
                return 'Just now';
            }

            const today = new Date();
            today.setHours(0, 0, 0, 0);

            const yesterday = new Date(today);
            yesterday.setDate(yesterday.getDate() - 1);

            const tomorrow = new Date(today);
            tomorrow.setDate(tomorrow.getDate() + 1);

            const orderDay = new Date(orderDate);
            orderDay.setHours(0, 0, 0, 0);

            const timeStr = orderDate.toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: true
            });

            if (orderDay.getTime() === today.getTime()) {
                return `Today, ${timeStr}`;
            } else if (orderDay.getTime() === yesterday.getTime()) {
                return `Yesterday, ${timeStr}`;
            } else if (orderDay.getTime() === tomorrow.getTime()) {
                return `Tomorrow, ${timeStr}`;
            } else {
                return orderDate.toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: true
                });
            }
        } catch (error) {
            console.error("Date formatting error:", error);
            return 'Just now';
        }
    };

    // Function to shift order to a different table
    const handleShiftTable = () => {
        setShowContextMenu(false);

        // Check if ModalManager is available
        if (ModalManager && typeof ModalManager.createCenterModal === 'function') {
            // Fetch available tables from UserSession
            const availableTables = UserSession?.seller?.tables || [];

            const modalId = 'shift-table-modal-' + Date.now();
            let content = `
                <div id="shift-table-form">
                    <div id="shift-table-error-container" class="mb-4 hidden p-3 bg-red-50 text-red-700 rounded-md"></div>
                    <div class="mb-4">
                        <div class="text-gray-700 mb-2">
                            Current Source: <span class="font-medium">${tableId || variant || 'Direct'}</span>
                        </div>
                    </div>
                    <div class="mb-6">
                        <label class="block text-gray-700 mb-2" for="target-table">
                            Select Target Table
                        </label>
                        <select
                            id="target-table"
                            class="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
            `;

            // Add options for available tables
            if (availableTables.length > 0) {
                availableTables.forEach(table => {
                    // Don't include the current table
                    if (table.id !== tableId && table.title !== tableId) {
                        content += `<option value="${table.id || table.title}">${table.title}</option>`;
                    }
                });
            } else {
                // If no tables are available, add some default options
                for (let i = 1; i <= 10; i++) {
                    if (`T${i}` !== tableId) {
                        content += `<option value="T${i}">T${i}</option>`;
                    }
                }
            }

            content += `
                        </select>
                    </div>
                </div>
            `;

            const actions = `
                <div class="flex justify-end gap-3">
                    <button
                        id="cancel-shift-table"
                        type="button"
                        class="px-4 py-2 border rounded-md hover:bg-gray-50"
                    >
                        Cancel
                    </button>
                    <button
                        id="save-shift-table"
                        type="button"
                        class="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                    >
                        Shift Order
                    </button>
                </div>
            `;

            const modal = ModalManager.createCenterModal({
                id: modalId,
                title: `Shift Order #${order.billNo || order.id?.slice(-6)} to Another Table`,
                content: content,
                actions: actions,
                onShown: (modalControl) => {
                    const targetTableSelect = document.getElementById('target-table');
                    const errorContainer = document.getElementById('shift-table-error-container');
                    const cancelButton = document.getElementById('cancel-shift-table');
                    const saveButton = document.getElementById('save-shift-table');

                    if (targetTableSelect && cancelButton && saveButton) {
                        cancelButton.addEventListener('click', () => {
                            modalControl.close();
                        });

                        saveButton.addEventListener('click', async () => {
                            try {
                                const targetTableId = targetTableSelect.value;

                                if (!targetTableId) {
                                    errorContainer.textContent = "Please select a target table";
                                    errorContainer.classList.remove('hidden');
                                    return;
                                }

                                // Prepare update object
                                const updateData = {
                                    tableId: targetTableId
                                };

                                // If this is a variant order (like Swiggy, Zomato), clear the priceVariant field
                                if (variant && !tableId) {
                                    updateData.priceVariant = null;
                                }

                                // Update the order in Firestore
                                await sdk.db.collection("Orders").doc(order.id).update(updateData);

                                modalControl.close();

                                if (ModalManager && typeof ModalManager.showToast === 'function') {
                                    ModalManager.showToast(`Order shifted to table ${targetTableId}`);
                                } else {
                                    showToast(`Order shifted to table ${targetTableId}`);
                                }

                                // Comprehensive UI refresh approach
                                // 1. Refresh tables data
                                if (refreshTables && typeof refreshTables === 'function') {
                                    refreshTables();
                                }

                                // 2. Force reload of kitchen orders to update the dining section
                                if (setupKitchenOrdersListener && typeof setupKitchenOrdersListener === 'function') {
                                    setupKitchenOrdersListener();
                                }

                                // 3. Trigger any order context refresh if available
                                if (refreshOrders && typeof refreshOrders === 'function') {
                                    refreshOrders();
                                }

                                // 4. Add a marker to the dining tables section to detect if it's empty after update
                                const diningTablesSection = document.querySelector('.grid.grid-cols-2.md\\:grid-cols-3.lg\\:grid-cols-4.xl\\:grid-cols-5.gap-3');
                                if (diningTablesSection) {
                                    // Mark the section for detection
                                    diningTablesSection.classList.add('dining-tables-refreshed');

                                    // Check if the section becomes empty after the update
                                    setTimeout(() => {
                                        const refreshedSection = document.querySelector('.dining-tables-refreshed');
                                        if (refreshedSection && (!refreshedSection.children || refreshedSection.children.length === 0)) {
                                            console.log("Dining tables section is empty after update, reloading page");
                                            window.location.reload();
                                        } else {
                                            // Remove the marker class
                                            if (refreshedSection) {
                                                refreshedSection.classList.remove('dining-tables-refreshed');
                                            }
                                        }
                                    }, 1500);
                                }

                            } catch (error) {
                                console.error("Error shifting order:", error);
                                errorContainer.textContent = "Failed to shift order: " + (error.message || "Unknown error");
                                errorContainer.classList.remove('hidden');
                            }
                        });
                    }
                }
            });
        } else {
            console.error("ModalManager not available for shift table operation");
            showToast("Cannot shift table: Modal manager not available", "error");
        }
    };

    const handlePrintKOT = async () => {
        try {
            // Try Bluetooth printing first if available
            if (BluetoothPrinting && BluetoothPrinting.isSupported()) {
                try {
                    // Get order channel for proper printer selection
                    const channel = order.priceVariant || 'Default';
                    await BluetoothPrinting.printKOT(order.id, channel);
                    showToast("KOT printed successfully", "success");
                    return; // Exit if Bluetooth printing succeeds
                } catch (btError) {
                    console.error("Bluetooth printing failed:", btError);

                    // Handle user cancellation errors
                    if (btError.message.includes("Device selection cancelled") ||
                        btError.message.includes("No printer selected") ||
                        btError.message.includes("cancelled by user") ||
                        btError.name === "NotFoundError") {
                        showToast("Printing cancelled", "info");
                        return;
                    }

                    // If it's a connection error or unsupported device, show helpful message
                    if (btError.message.includes("No suitable service") ||
                        btError.message.includes("No services found") ||
                        btError.message.includes("not supported as a printer") ||
                        btError.message.includes("cannot be used for printing") ||
                        (btError.name === 'NetworkError' && btError.message.includes("Unsupported device"))) {
                        showToast("Could not connect to printer. Please select a compatible thermal printer.", "error");
                        return;
                    }

                    // Generic error case
                    showToast(`Printing error: ${btError.message}`, "error");

                    // Fall through to traditional printing for other errors
                    showToast("Bluetooth printing failed, falling back to standard printing", "warning");
                }
            }

            // Traditional KOT printing (fallback)
            if (UserSession?.seller?.kotEnabled) {
                try {
                    console.log("Attempting fallback KOT printing for order:", order.id);
                    const orderRef = sdk.db.collection("Orders").doc(order.id);
                    const orderDoc = await orderRef.get();
                    if (!orderDoc.exists) {
                        throw new Error("Order not found for fallback printing.");
                    }
                    const orderData = orderDoc.data();

                    // Check if there are newly added items
                    const newlyAddedItems = orderData.items?.filter(item => item.newlyAdded === true);
                    const hasNewItems = newlyAddedItems && newlyAddedItems.length > 0;

                    // Process the newly added items to show only the newly added quantities
                    const processedItems = hasNewItems ? newlyAddedItems.map(item => {
                        // If we have a specific newly added quantity, use that
                        if (item.newlyAddedQty && item.newlyAddedQty > 0) {
                            console.log(`Browser KOT: Item ${item.title} has newlyAddedQty=${item.newlyAddedQty}, original qnt=${item.qnt}`);
                            return {
                                ...item,
                                qnt: item.newlyAddedQty, // Use only the newly added quantity for KOT
                                originalQnt: item.qnt // Keep track of the original quantity
                            };
                        }
                        console.log(`Browser KOT: Item ${item.title} has no newlyAddedQty, using full quantity ${item.qnt}`);
                        return item; // Otherwise keep the item as is
                    }) : [];

                    // Check if any items have originalQnt property (indicating quantity additions)
                    const hasQuantityAdditions = processedItems.some(item => item.originalQnt !== undefined);
                    const kotTitle = hasNewItems
                        ? (hasQuantityAdditions ? 'KITCHEN ORDER TICKET (ADDITIONS)' : 'KITCHEN ORDER TICKET (NEW ITEMS)')
                        : 'KITCHEN ORDER TICKET';

                    let kotHtml = `
                        <div style="font-family: 'Courier New', Courier, monospace; font-size: 12px; width: 280px; margin: 0 auto; padding: 10px;">
                            <h2 style="text-align: center; margin: 0 0 5px 0;">${kotTitle}</h2>
                            <p style="text-align: center; margin: 0 0 10px 0; border-bottom: 1px dashed #000; padding-bottom: 5px;">
                                ${UserSession?.seller?.businessName || 'Your Business'}
                            </p>
                            <p><strong>Order #:</strong> ${orderData.billNo || orderData.id?.substring(0, 6) || 'N/A'}</p>
                            ${orderData.tableId ? `<p><strong>Table:</strong> ${orderData.tableId}</p>` : ''}
                            <p><strong>Time:</strong> ${new Date(orderData.date?.toDate ? orderData.date.toDate() : orderData.date || new Date()).toLocaleTimeString()}</p>
                            ${hasNewItems ? `<p><strong>Added Items:</strong> ${newlyAddedItems.length} of ${orderData.items.length}</p>` : ''}
                            ${orderData.sourceName ? `<p><strong>Source:</strong> ${orderData.sourceName}</p>` : ''}
                            <hr style="border: none; border-top: 1px dashed #000; margin: 10px 0;" />
                            <p style="font-weight: bold; margin-bottom: 5px;">ITEMS:</p>
                    `;

                    // If there are newly added items, only print those with correct quantities
                    const itemsToPrint = hasNewItems ? processedItems : orderData.items;

                    if (itemsToPrint && itemsToPrint.length > 0) {
                        itemsToPrint.forEach(item => {
                            const quantity = item.quantity || item.qnt || 1;
                            const title = item.title || 'Unknown Item';
                            kotHtml += `<div style="display: flex; justify-content: space-between; margin-bottom: 3px;">
                                            <span>${quantity}x ${title}</span>
                                        </div>`;
                            if (item.instructions) {
                                kotHtml += `<div style="font-size: 10px; padding-left: 15px; margin-bottom: 3px;"><em>Notes: ${item.instructions}</em></div>`;
                            }
                        });

                        // After printing newly added items, clear their flags to avoid duplicate printing
                        if (hasNewItems) {
                            try {
                                // Update the items to clear the newlyAdded flag and quantity
                                const updatedItems = orderData.items.map(item => ({
                                    ...item,
                                    newlyAdded: false,
                                    newlyAddedQty: 0  // Reset the newly added quantity as well
                                }));

                                // Schedule the update to run after printing is complete
                                setTimeout(async () => {
                                    try {
                                        const orderRef = sdk.db.collection("Orders").doc(orderData.id);
                                        await orderRef.update({ items: updatedItems });
                                        console.log("Cleared newlyAdded flags and quantities after fallback KOT printing");
                                    } catch (err) {
                                        console.error("Error clearing newlyAdded flags:", err);
                                    }
                                }, 500);
                            } catch (error) {
                                console.error("Error preparing flag update:", error);
                            }
                        }
                    } else {
                        kotHtml += "<p>No items</p>";
                    }

                    if (orderData.instructions) {
                        kotHtml += `<hr style="border: none; border-top: 1px dashed #000; margin: 10px 0;" />`;
                        kotHtml += `<p style="font-weight: bold; margin-bottom: 5px;">SPECIAL INSTRUCTIONS:</p>`;
                        kotHtml += `<p>${orderData.instructions}</p>`;
                    }

                    kotHtml += `<hr style="border: none; border-top: 1px dashed #000; margin: 10px 0;" />`;
                    kotHtml += `<p style="text-align: center; margin-top: 10px;">* End of KOT *</p>`;
                    kotHtml += `</div>`;

                    const printFrame = document.createElement('iframe');
                    printFrame.style.position = 'fixed';
                    printFrame.style.top = '-9999px'; // Position off-screen
                    printFrame.style.left = '-9999px';
                    printFrame.style.width = '0'; // Minimize impact
                    printFrame.style.height = '0';
                    printFrame.style.border = '0';
                    document.body.appendChild(printFrame);

                    printFrame.contentDocument.open();
                    printFrame.contentDocument.write('<html><head><title>Print KOT</title>');
                    printFrame.contentDocument.write('<style> body { margin: 0; padding: 0; color: #000; background: #fff; } @media print { @page { size: 80mm auto; margin: 3mm; } html, body { width: 74mm; } h2, p { margin: 0 0 3px 0; } hr { margin: 5px 0; } } </style>');
                    printFrame.contentDocument.write('</head><body>');
                    printFrame.contentDocument.write(kotHtml);
                    printFrame.contentDocument.write('</body></html>');
                    printFrame.contentDocument.close();

                    // Ensure content is loaded before printing
                    printFrame.onload = () => {
                        printFrame.contentWindow.focus();
                        printFrame.contentWindow.print();
                        // More robust cleanup
                        setTimeout(() => {
                            if (document.body.contains(printFrame)) {
                                document.body.removeChild(printFrame);
                            }
                        }, 1000); // Delay to ensure print dialog is processed
                    };
                    // For browsers that might not fire onload for dynamically written iframes promptly
                    if (printFrame.contentWindow.document.readyState === 'complete') {
                        printFrame.onload();
                    }


                    showToast('KOT sent to browser print dialog', 'success');

                } catch (fallbackError) {
                    console.error('Error during fallback KOT printing:', fallbackError);
                    showToast(`Fallback KOT printing failed: ${fallbackError.message}`, 'error');
                }
            } else {
                console.log('Print KOT for order (simulation - KOTs not enabled or no fallback defined):', order.id);
                showToast('KOT Printed successfully (simulation)', 'success');
            }
        } catch (err) {
            console.error('Error printing KOT:', err);
            showToast(`Failed to print KOT: ${err.message}`, 'error');
        }
    };

    const handlePrintBill = async () => {
        let billPrintedSuccessfully = false;
        let userCancelledBluetooth = false;

        try {
            // Try Bluetooth printing first if available
            if (BluetoothPrinting && BluetoothPrinting.isSupported()) {
                try {
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
                    showToast("Bill printed successfully via Bluetooth", "success");
                    billPrintedSuccessfully = true;
                } catch (btError) {
                    console.error("Bluetooth bill printing failed:", btError);
                    if (btError.message.includes("Device selection cancelled") ||
                        btError.message.includes("No printer selected") ||
                        btError.message.includes("cancelled by user") ||
                        btError.name === "NotFoundError") {
                        showToast("Bluetooth printing cancelled by user.", "info");
                        userCancelledBluetooth = true; // Mark that user actively cancelled.
                        // Do not automatically fall back if user explicitly cancelled.
                        // UI should ideally give option to print later or complete without printing.
                    } else {
                        showToast(`Bluetooth printing error: ${btError.message}. Falling back to browser print.`, "warning");
                    }
                }
            }

            // Fallback to browser print if Bluetooth didn't succeed AND user didn't cancel Bluetooth
            if (!billPrintedSuccessfully && !userCancelledBluetooth && (UserSession?.seller?.billEnabled !== false)) {
                console.log("Attempting fallback browser print for bill:", order.id);
                try {
                    const orderRef = sdk.db.collection("Orders").doc(order.id);
                    const orderDoc = await orderRef.get();
                    if (!orderDoc.exists) throw new Error("Order not found for bill printing.");
                    const orderData = orderDoc.data();

                    // --- Bill HTML Formatting ---
                    let billHtml = `<div style="font-family: 'Courier New', monospace; font-size: 11px; width: 280px; margin: 0 auto; padding: 5px;">
                        <h2 style="text-align: center; margin: 0 0 5px 0; font-size: 14px;">${UserSession?.seller?.gstEnabled ? 'TAX INVOICE' : 'BILL/RECEIPT'}</h2>
                        <p style="text-align: center; margin:0; font-size: 12px;"><strong>${UserSession?.seller?.businessName || 'Your Business'}</strong></p>
                        ${UserSession?.seller?.address ? `<p style="text-align: center; font-size: 9px; margin:0;">${UserSession.seller.address}</p>` : ''}
                        ${UserSession?.seller?.phone ? `<p style="text-align: center; font-size: 9px; margin:0;">Ph: ${UserSession.seller.phone}</p>` : ''}
                        ${UserSession?.seller?.gstEnabled && UserSession?.seller?.gstIN ? `<p style="text-align: center; font-size: 9px; margin:0;">GSTIN: ${UserSession.seller.gstIN}</p>` : ''}
                        <hr style="border:none; border-top: 1px dashed #000; margin: 4px 0;" />
                        <div style="display:flex; justify-content:space-between; font-size:10px;"><span>Bill: ${orderData.billNo || orderData.id?.substring(0, 8) || 'N/A'}</span><span>${new Date(orderData.date?.toDate ? orderData.date.toDate() : orderData.date || new Date()).toLocaleDateString()}</span></div>
                        <div style="font-size:10px;">Time: ${new Date(orderData.date?.toDate ? orderData.date.toDate() : orderData.date || new Date()).toLocaleTimeString()}</div>
                        ${orderData.customer?.name ? `<p style="font-size:10px;">Cust: ${orderData.customer.name}</p>` : ''}
                        ${orderData.tableId ? `<p style="font-size:10px;">Table: ${orderData.tableId}</p>` : ''}
                        <hr style="border:none; border-top: 1px dashed #000; margin: 4px 0;" />
                        <table style="width: 100%; font-size: 10px; border-collapse: collapse;">
                            <thead><tr style="border-bottom: 1px dashed #000;"><th style="text-align:left; padding-bottom:2px;">Item</th><th style="text-align:right; padding-bottom:2px;">Qty</th><th style="text-align:right; padding-bottom:2px;">Rate</th><th style="text-align:right; padding-bottom:2px;">Amount</th></tr></thead><tbody>`;

                    let calculatedSubTotal = 0;
                    if (orderData.items && orderData.items.length > 0) {
                        orderData.items.forEach(item => {
                            const quantity = parseFloat(item.quantity || item.qnt || 1);
                            const price = parseFloat(item.price || 0);
                            const amount = quantity * price;
                            calculatedSubTotal += amount;
                            billHtml += `<tr style="vertical-align:top;">
                                            <td style="padding:2px 0;">${item.title || 'Unknown Item'}</td>
                                            <td style="text-align:right; padding:2px 0;">${quantity}</td>
                                            <td style="text-align:right; padding:2px 0;">${price.toFixed(2)}</td>
                                            <td style="text-align:right; padding:2px 0;">${amount.toFixed(2)}</td>
                                         </tr>`;
                        });
                    }
                    billHtml += `</tbody></table><hr style="border:none; border-top: 1px dashed #000; margin: 4px 0;" />`;

                    const subTotalForDisplay = orderData.subTotal?.toFixed(2) || calculatedSubTotal.toFixed(2);
                    billHtml += `<div style="display:flex; justify-content:space-between; font-size:10px;"><span>Subtotal:</span><span>${subTotalForDisplay}</span></div>`;

                    let totalAmount = parseFloat(orderData.subTotal || calculatedSubTotal);
                    if (orderData.discount && parseFloat(orderData.discount) > 0) {
                        const discountVal = parseFloat(orderData.discount);
                        billHtml += `<div style="display:flex; justify-content:space-between; font-size:10px;"><span>Discount:</span><span>-${discountVal.toFixed(2)}</span></div>`;
                        // totalAmount -= discountVal; // Assuming discount is already applied in orderData.total
                    }

                    if (orderData.charges && Array.isArray(orderData.charges)) {
                        // Use ChargesCalculator for consistent charge calculations
                        const chargesCalculation = ChargesCalculator?.calculateCharges(
                            totalAmount,
                            orderData.charges,
                            orderData.discount || 0
                        );

                        if (chargesCalculation && chargesCalculation.calculatedCharges) {
                            chargesCalculation.calculatedCharges.forEach(charge => {
                                billHtml += `<div style="display:flex; justify-content:space-between; font-size:10px;"><span>${charge.displayName}:</span><span>${charge.calculatedAmount.toFixed(2)}</span></div>`;
                            });

                            // Update total amount for display
                            totalAmount = chargesCalculation.finalAmount;
                        }
                    }

                    billHtml += `<hr style="border:none; border-top: 1px solid #000; margin: 4px 0;" />`;
                    billHtml += `<div style="display:flex; justify-content:space-between; font-weight:bold; font-size: 12px;"><span>TOTAL:</span><span>${totalAmount.toFixed(2)}</span></div>`;
                    billHtml += `<hr style="border:none; border-top: 1px solid #000; margin: 4px 0;" />`;
                    billHtml += `<p style="font-size:10px;"><strong>Mode:</strong> ${orderData.payMode || 'N/A'}</p>`;
                    if (orderData.notes) billHtml += `<p style="font-size:9px;">Notes: ${orderData.notes}</p>`;
                    billHtml += `<p style="text-align:center; font-size:9px; margin-top:8px;">Thank you! Visit Again!</p></div>`;
                    // --- End Bill HTML Formatting ---

                    const printFrame = document.createElement('iframe');
                    Object.assign(printFrame.style, { position: 'fixed', top: '-9999px', left: '-9999px', width: '0', height: '0', border: '0' });
                    document.body.appendChild(printFrame);
                    printFrame.contentDocument.open();
                    printFrame.contentDocument.write('<html><head><title>Print Bill</title><style>body{margin:0;padding:0;color:#000;background:#fff} @media print{@page{size:80mm auto;margin:3mm} html,body{width:74mm; font-size: 10px;} h2,p,div,span,th,td{margin:0 0 2px 0; padding:0;} table{width:100%;} hr{margin:3px 0;}}</style></head><body>' + billHtml + '</body></html>');
                    printFrame.contentDocument.close();

                    const doPrint = () => {
                        try {
                            printFrame.contentWindow.focus();
                            printFrame.contentWindow.print();
                            billPrintedSuccessfully = true;
                            showToast("Bill sent to browser print dialog", "success");
                        } catch (printError) {
                            console.error("Error triggering browser print:", printError);
                            showToast("Could not open print dialog. Please check browser pop-up settings.", "error");
                        }
                        setTimeout(() => document.body.contains(printFrame) && document.body.removeChild(printFrame), 1500);
                    };

                    if (printFrame.contentWindow.document.readyState === 'complete') {
                        doPrint();
                    } else {
                        printFrame.onload = doPrint;
                    }
                } catch (fallbackErr) {
                    console.error("Error during fallback bill printing:", fallbackErr);
                    showToast(`Fallback bill printing failed: ${fallbackErr.message}`, "error");
                }
            }

            // Only complete order if it wasn't a user cancellation of Bluetooth and print was attempted or bill printing is disabled
            if (!userCancelledBluetooth) {
                const orderRef = sdk.db.collection("Orders").doc(order.id);
                
                // Get current document first
                const orderDoc = await orderRef.get();
                const orderData = orderDoc.data();
                
                // Get current status array or create empty one
                const currentStatus = orderData.status || [];
                
                // Create new status entry
                const newStatusEntry = {
                    label: "COMPLETED",
                    date: new Date()
                };
                
                // Add new status to array
                const updatedStatus = [...currentStatus, newStatusEntry];
                
                // Update the document
                await orderRef.update({
                    status: updatedStatus,
                    currentStatus: {
                        label: "COMPLETED",
                        date: new Date()
                    },
                    printed: billPrintedSuccessfully // Optionally track if bill was printed
                });
                showToast("Order marked as COMPLETED", "info");

                if (refreshOrders) refreshOrders();
                else if (refreshData) refreshData();
                return billPrintedSuccessfully;
            } else {
                // User cancelled Bluetooth, don't complete order automatically
                return false;
            }

        } catch (err) {
            console.error('Error in handlePrintBill process:', err);
            showToast(`Operation failed: ${err.message}`, 'error');
            return false;
        }
    };

    const handleBluetoothPrint = async () => {
        try {
            // This function is no longer needed as we've integrated Bluetooth printing into handlePrintKOT
            // Keeping it for backward compatibility, but just forwarding to handlePrintKOT
            await handlePrintKOT();
        } catch (error) {
            console.error("Error printing:", error);
        }
    };

    const handleCheckout = async () => {
        try {
            // Create a container for the CheckoutSheet
            const checkoutContainer = document.createElement('div');
            checkoutContainer.id = 'checkout-container';
            checkoutContainer.className = 'fixed inset-0 z-50';
            document.body.appendChild(checkoutContainer);

            try {
                // Convert order items to cart format expected by CheckoutSheet
                const cart = {};

                // Make sure order and order.items exist before trying to loop
                if (order && Array.isArray(order.items)) {
                    order.items.forEach(item => {
                        // Make sure item has required properties
                        if (item && item.pid) {
                            cart[item.pid] = {
                                product: {
                                    id: item.pid,
                                    title: item.title || 'Unknown Item',
                                    price: item.price || 0,
                                    mrp: item.mrp || item.price || 0,
                                    imgs: item.thumb ? [item.thumb] : [],
                                    charges: item.charges || [], // Use item's charges if available
                                    cat: item.cat || 'Other',
                                    veg: item.veg || false
                                },
                                quantity: item.quantity || item.qnt || 1
                            };
                        }
                    });
                }

                // Create a root element for React 18
                const root = ReactDOM.createRoot(checkoutContainer);

                // Render the CheckoutSheet component
                root.render(
                    createElement(CheckoutSheet, {
                        cart: cart,
                        clearCallback: async () => {
                            // Cleanup and close
                            root.unmount();
                            if (document.body.contains(checkoutContainer)) {
                                document.body.removeChild(checkoutContainer);
                            }
                            // Refresh orders list or page
                            if (refreshOrders && typeof refreshOrders === 'function') {
                                refreshOrders();
                            } else if (refreshData && typeof refreshData === 'function') {
                                refreshData();
                            }
                        },
                        tableId: tableId,
                        checkout: true,
                        orderId: order ? order.id : null,
                        priceVariant: variant,
                        charges: order?.charges || [],
                        onClose: () => {
                            // Cleanup
                            root.unmount();
                            if (document.body.contains(checkoutContainer)) {
                                document.body.removeChild(checkoutContainer);
                            }
                        }
                    })
                );
            } catch (error) {
                console.error("Error rendering CheckoutSheet:", error);
                if (document.body.contains(checkoutContainer)) {
                    document.body.removeChild(checkoutContainer);
                }
                throw error;
            }
        } catch (error) {
            console.error("Error opening checkout:", error);
            showToast("Failed to open checkout", "error");
        }
    };

    const handleAddNewItem = () => {
        // Check if POS component is available
        if (!POS) {
            console.error("POS component is not defined");
            showToast("Cannot open POS: component not available", "error");
            return;
        }

        // Create a container for the POS component
        const posContainer = document.createElement('div');
        posContainer.id = 'pos-items-container';
        posContainer.className = 'fixed inset-0 z-50';
        document.body.appendChild(posContainer);

        try {
            // Create a root element for React 18
            const root = ReactDOM.createRoot(posContainer);

            // Convert order to the format expected by POS component
            const orderForPOS = {
                ...order,
                ref: sdk.db.collection("Orders").doc(order.id)
            };

            // Render the POS component
            root.render(
                createElement(POS, {
                    title: `Add to Order #${order.billNo || order.id?.slice(-6)}`,
                    tableId: tableId,
                    variant: variant,
                    order: orderForPOS,
                    includeAllProducts: true, // Add this flag to force showing all products
                    onClose: () => {
                        // Unmount and clean up
                        root.unmount();
                        if (document.body.contains(posContainer)) {
                            document.body.removeChild(posContainer);
                        }
                    }
                })
            );
        } catch (error) {
            console.error("Error rendering POS:", error);
            if (document.body.contains(posContainer)) {
                document.body.removeChild(posContainer);
            }
            showToast("Failed to open POS", "error");
        }
    };

    const toggleItemServed = async (item, served) => {
        try {
            // Get a reference to the order document
            const orderRef = sdk.db.collection("Orders").doc(order.id);

            // Get the current order data
            const orderDoc = await orderRef.get();
            if (!orderDoc.exists) {
                throw new Error('Order not found');
            }

            const orderData = orderDoc.data();

            // Update the served status of the specific item
            const updatedItems = orderData.items.map(i => {
                if (i.pid === item.pid) {
                    return { ...i, served: served };
                }
                return i;
            });

            // Update the order with the modified items array
            await orderRef.update({ items: updatedItems });

            showToast(`Item ${served ? 'served' : 'unserved'}`);
        } catch (err) {
            console.error('Error updating item served status:', err);
            showToast('Failed to update item status', 'error');
        }
    };

    const handleRemoveItem = async (item) => {
        try {
            // Get a reference to the order document
            const orderRef = sdk.db.collection("Orders").doc(order.id);

            // Get the current order data
            const orderDoc = await orderRef.get();
            if (!orderDoc.exists) {
                throw new Error('Order not found');
            }

            const orderData = orderDoc.data();

            // Find the item in the current items array
            const itemIndex = orderData.items.findIndex(i => i.pid === item.pid);
            if (itemIndex === -1) {
                throw new Error('Item not found in order');
            }

            // Get current quantity - standardize on qnt property
            const currentQty = parseInt(orderData.items[itemIndex].qnt || 1);

            // If quantity is 1, remove the item completely
            if (currentQty <= 1) {
                // Remove the item from the items array
                const updatedItems = orderData.items.filter(i => i.pid !== item.pid);
                // Update the order with the modified items array
                await orderRef.update({ items: updatedItems });
                showToast(`${item.title} removed from order`);
            } else {
                // Decrease quantity by 1
                const updatedItems = [...orderData.items];
                updatedItems[itemIndex] = {
                    ...updatedItems[itemIndex],
                    qnt: currentQty - 1
                };
                // Update the order with the modified items array
                await orderRef.update({ items: updatedItems });
                showToast(`Decreased ${item.title} quantity by 1`);
            }
        } catch (err) {
            console.error('Error updating item quantity:', err);
            showToast('Failed to update item quantity', 'error');
        }
    };

    const handleAddItem = async (item) => {
        try {
            // Get a reference to the order document
            const orderRef = sdk.db.collection("Orders").doc(order.id);

            // Get the current order data
            const orderDoc = await orderRef.get();
            if (!orderDoc.exists) {
                throw new Error('Order not found');
            }

            const orderData = orderDoc.data();

            // Find the item in the current items array
            const itemIndex = orderData.items.findIndex(i => i.pid === item.pid);
            if (itemIndex === -1) {
                throw new Error('Item not found in order');
            }

            // Get current quantity and increase by 1
            const currentQty = parseInt(orderData.items[itemIndex].qnt || 1);
            const updatedItems = [...orderData.items];
            updatedItems[itemIndex] = {
                ...updatedItems[itemIndex],
                qnt: currentQty + 1
            };

            // Update the order with the modified items array
            await orderRef.update({ items: updatedItems });
            showToast(`Added ${item.title} quantity by 1`);
        } catch (err) {
            console.error('Error updating item quantity:', err);
            showToast('Failed to update item quantity', 'error');
        }
    };

    // Helper function to get the item image URL
    const getItemImage = (item) => {
        // Check for thumb first (as in the Flutter model)
        return item.thumb || item.image || item.thumbnail || item.imageUrl || item.img || null;
    };

    // Helper function to get a category-appropriate icon
    const getCategoryIcon = (item) => {
        if (item.cat) {
            const cat = item.cat.toLowerCase();
            if (cat.includes('drink') || cat.includes('beverage')) return 'ph-coffee text-brown-500';
            if (cat.includes('dessert') || cat.includes('sweet')) return 'ph-cake text-yellow-600';
            if (cat.includes('pizza') || cat.includes('pie')) return 'ph-pizza text-orange-500';
            if (cat.includes('burger')) return 'ph-hamburger text-orange-700';
            if (cat.includes('salad') || cat.includes('veg')) return 'ph-plant text-green-500';
            if (cat.includes('chicken') || cat.includes('meat')) return 'ph-drumstick text-red-600';
            if (cat.includes('soup')) return 'ph-bowl-food text-yellow-700';
        }
        return 'ph-fork-knife text-gray-500';
    };

    // Calculate subtotal
    const subtotal = order.items?.reduce((sum, item) => sum + ((item.price || 0) * (item.qnt || 1)), 0) || 0;

    return (
        <div className="bg-white rounded-xl shadow-lg overflow-hidden mb-6" style={{ backgroundColor: "#fff8f8", borderRadius: "16px" }}>
            {/* Order Header */}
            <div className="p-4">
                <div className="flex items-center justify-between">
                    <div>
                        <h3 className="font-medium text-gray-800 text-lg">
                            Bill No: <span className="text-red-500">#{order.billNo || order.id?.slice(-6)}</span>
                        </h3>
                        <div className="flex items-center mt-1">
                            <p className="text-sm text-gray-600">
                                {formatTinyDateTime(order.date || order.placeDate)}
                            </p>
                            <span className="mx-2 text-gray-300">•</span>
                            <p className="text-sm text-gray-600 flex items-center">
                                <span className={`inline-block w-2 h-2 rounded-full mr-1 ${progressPercent === 100 ? 'bg-green-500' : 'bg-red-500'}`}></span>
                                {servedItems}/{totalItems} items
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center">
                        <button
                            className="p-2.5 text-red-500 hover:bg-red-50 rounded-full transition-colors flex items-center justify-center w-10 h-10"
                            onClick={handleAddNewItem}
                            aria-label="Add new item"
                        >
                            <i className="ph ph-plus-circle text-2xl"></i>
                        </button>
                        <div className="relative">
                            <button
                                className="p-2.5 text-gray-600 hover:bg-gray-50 rounded-full transition-colors flex items-center justify-center w-10 h-10"
                                onClick={() => setShowContextMenu(!showContextMenu)}
                                aria-label="More options"
                            >
                                <i className="ph ph-dots-three-vertical text-xl"></i>
                            </button>
                            {showContextMenu && (
                                <div
                                    ref={menuRef}
                                    className="absolute right-0 top-12 w-52 bg-white rounded-lg shadow-lg border border-gray-200 overflow-hidden z-50"
                                >
                                    <div className="py-1">
                                        <button
                                            className="w-full text-left px-4 py-3 text-gray-700 hover:bg-gray-50 flex items-center gap-3"
                                            onClick={handleShiftTable}
                                        >
                                            <i className="ph ph-arrows-left-right text-red-500"></i>
                                            <span>Shift to Table</span>
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Progress Bar */}
            <div className="h-2 bg-gray-100">
                <div
                    className="h-full bg-red-500 transition-all duration-300 ease-out rounded-r-full"
                    style={{ width: `${progressPercent}%` }}
                ></div>
            </div>

            {/* Order Items */}
            <div className="divide-y divide-pink-50">
                {order.items?.map((item, index) => (
                    <div key={index} className="p-4 hover:bg-pink-50 transition-colors">
                        <div className="flex items-center gap-3">
                            <input
                                type="checkbox"
                                checked={item.served || false}
                                onChange={(e) => toggleItemServed(item, e.target.checked)}
                                className="w-5 h-5 rounded border-gray-300 text-red-500 focus:ring-red-500 focus:ring-offset-0"
                                id={`item-${order.id}-${index}`}
                            />
                            <div className="w-14 h-14 bg-gray-100 rounded-lg flex items-center justify-center overflow-hidden">
                                {getItemImage(item) ? (
                                    <img
                                        src={getItemImage(item)}
                                        alt={item.title}
                                        className="w-full h-full object-cover"
                                        onError={(e) => {
                                            e.target.onerror = null;
                                            e.target.src = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 24 24" fill="none" stroke="%23ccc" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`;
                                        }}
                                    />
                                ) : (
                                    <i className={`ph ${getCategoryIcon(item)} text-gray-400 text-xl`}></i>
                                )}
                            </div>
                            <div className="flex-1 min-w-0">
                                <h4 className="font-medium text-gray-800 truncate">{item.title}</h4>
                                <div className="flex items-center mt-1">
                                    <span className="text-sm font-medium text-red-500">{UserSession?.getCurrency()}{item.price || 0}</span>
                                    {item.cat && (
                                        <>
                                            <span className="mx-1 text-gray-300">•</span>
                                            <span className="text-sm text-gray-600">{item.cat}</span>
                                        </>
                                    )}
                                </div>
                                {item.veg !== undefined && (
                                    <div className="mt-1">
                                        <span className={`inline-block w-4 h-4 border ${item.veg ? 'border-green-500' : 'border-red-500'} p-0.5 rounded-sm`}>
                                            <span className={`block w-full h-full rounded-sm ${item.veg ? 'bg-green-500' : 'bg-red-500'}`}></span>
                                        </span>
                                    </div>
                                )}
                            </div>
                            <div className="flex items-center">
                                <div className="bg-gray-100 rounded-full px-1 py-0.5 flex items-center gap-1">
                                    <button
                                        className="w-7 h-7 flex items-center justify-center text-red-500 hover:bg-red-50 rounded-full"
                                        onClick={() => handleRemoveItem(item)}
                                        aria-label="Remove item"
                                    >
                                        <i className="ph ph-minus"></i>
                                    </button>
                                    <span className="w-8 text-center font-medium">
                                        {item.qnt || 1}
                                    </span>
                                    <button
                                        className="w-7 h-7 flex items-center justify-center text-red-500 hover:bg-red-50 rounded-full"
                                        onClick={() => handleAddItem(item)}
                                        aria-label="Add item"
                                    >
                                        <i className="ph ph-plus"></i>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            {/* Special Instructions */}
            <div className="p-4 border-t border-pink-100">
                <div className="space-y-2">
                    <label htmlFor="special-instructions" className="block font-medium text-gray-700 flex items-center">
                        <i className="ph ph-note-pencil text-red-500 mr-1.5"></i>
                        Special Instructions
                    </label>
                    <textarea
                        id="special-instructions"
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-red-500 focus:border-red-500 text-sm"
                        placeholder="Add any special instructions for this order..."
                        rows="2"
                        value={order.instructions || ''}
                        onChange={(e) => handleInstructionsChange(e.target.value)}
                    ></textarea>
                </div>
            </div>

            {/* Subtotal */}
            <div className="p-4 border-t border-pink-100">
                <div className="flex justify-between items-center">
                    <h3 className="font-medium text-gray-700">Sub Total:</h3>
                    <span className="font-medium text-red-500 text-lg">{UserSession?.getCurrency()}{subtotal.toFixed(2)}</span>
                </div>

                {/* Use ChargesCalculator for consistent charge calculations */}
                {(() => {
                    // Calculate charges using the utility - ensure charges is always an array
                    const chargesCalculation = ChargesCalculator?.calculateCharges(
                        subtotal,
                        order.charges || [],
                        order.discount || 0
                    ) || {
                        subtotal,
                        discount: order.discount || 0,
                        calculatedCharges: [],
                        finalAmount: subtotal - (order.discount || 0)
                    };

                    const { calculatedCharges, finalAmount } = chargesCalculation;

                    return (
                        <>
                            {/* Display charges */}
                            {calculatedCharges && calculatedCharges.length > 0 && (
                                <div className="mt-2 space-y-1">
                                    {calculatedCharges.map((charge, index) => (
                                        <div key={index} className="flex justify-between items-center text-sm">
                                            <span className="text-gray-600">{charge.displayName}:</span>
                                            <span className="text-gray-800">{UserSession?.getCurrency()}{charge.calculatedAmount.toFixed(2)}</span>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* Display discount if any */}
                            {order.discount && parseFloat(order.discount) > 0 && (
                                <div className="mt-2 flex justify-between items-center text-sm">
                                    <span className="text-green-600">Discount:</span>
                                    <span className="text-green-600">- {UserSession?.getCurrency()}{parseFloat(order.discount).toFixed(2)}</span>
                                </div>
                            )}

                            {/* Display total */}
                            {(calculatedCharges && calculatedCharges.length > 0) || (order.discount && parseFloat(order.discount) > 0) ? (
                                <div className="mt-2 pt-2 border-t border-gray-100 flex justify-between items-center">
                                    <h3 className="font-bold text-gray-800">Total:</h3>
                                    <span className="font-bold text-red-500 text-lg">{UserSession?.getCurrency()}{finalAmount.toFixed(2)}</span>
                                </div>
                            ) : null}
                        </>
                    );
                })()}
            </div>

            {/* Action Buttons */}
            <div className="p-4 pt-0">
                <div className="flex gap-3">
                    <button
                        className="flex-1 py-2.5 border border-red-500 text-red-500 rounded-lg hover:bg-red-50 transition-colors flex items-center justify-center"
                        onClick={handlePrintKOT}
                    >
                        <i className="ph ph-printer mr-2"></i>
                        Print KOT
                    </button>
                    <button
                        className="flex-1 py-2.5 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors flex items-center justify-center"
                        onClick={handleCheckout}
                    >
                        <i className="ph ph-credit-card mr-2"></i>
                        Checkout
                    </button>
                </div>
            </div>
        </div>
    );
}

// CustomerSearch Component
export function CustomerSearch({ isOpen, onClose, onSelectCustomer }) {
    const [searchTerm, setSearchTerm] = useState('');
    const [customers, setCustomers] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [showAddForm, setShowAddForm] = useState(false);
    const [newCustomer, setNewCustomer] = useState({
        name: '',
        phone: ''
    });

    // Search for customers when the search term changes
    useEffect(() => {
        if (!searchTerm || searchTerm.length < 2) {
            setCustomers([]);
            return;
        }

        const delayDebounceFn = setTimeout(async () => {
            try {
                setLoading(true);
                setError(null);

                // Search for customers
                const results = await sdk.db.collection("Customers")
                    .where("phone", "==", searchTerm)
                    .limit(10)
                    .get()
                    .then(snapshot => snapshot.docs.map(doc => ({
                        id: doc.id,
                        ...doc.data()
                    })));

                setCustomers(results);
            } catch (err) {
                console.error('Error searching customers:', err);
                setError('Failed to search customers');
            } finally {
                setLoading(false);
            }
        }, 500);

        return () => clearTimeout(delayDebounceFn);
    }, [searchTerm]);

    // Handle selecting a customer
    const handleSelectCustomer = (customer) => {
        onSelectCustomer(customer);
        onClose();
    };

    // Handle creating a new customer
    const handleCreateCustomer = async () => {
        try {
            if (!newCustomer.name || !newCustomer.phone) {
                setError('Please enter both name and phone number');
                return;
            }

            setLoading(true);
            setError(null);

            // Create the customer
            const customerData = {
                ...newCustomer,
                date: new Date(),
                orderCount: 0,
                totalSpent: 0,
                balance: 0
            };

            // Add to Firestore
            const newCustomerRef = sdk.db.collection("Customers").doc();
            await newCustomerRef.set(customerData);

            const customer = {
                id: newCustomerRef.id,
                ...customerData
            };

            // Select the new customer
            handleSelectCustomer(customer);
        } catch (err) {
            console.error('Error creating customer:', err);
            setError('Failed to create customer');
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div
            className={`fixed inset-0 z-50 flex items-center justify-center p-4 ${isOpen ? 'visible' : 'invisible'}`}
            onClick={onClose}
        >
            <div className="fixed inset-0 bg-black bg-opacity-50"></div>
            <div className="bg-section-bg w-full max-w-md rounded-lg shadow-section overflow-hidden relative z-10" onClick={e => e.stopPropagation()}>
                <div className="p-4">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-xl font-bold">Select Customer</h2>
                        <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
                            <i className="ph ph-x text-xl"></i>
                        </button>
                    </div>

                    {error && (
                        <div className="mb-4 p-2 bg-red-50 text-red-600 rounded">
                            {error}
                        </div>
                    )}

                    {!showAddForm ? (
                        <>
                            <div className="mb-4">
                                <div className="relative">
                                    <input
                                        type="text"
                                        value={searchTerm}
                                        onChange={e => setSearchTerm(e.target.value)}
                                        placeholder="Search by name or phone"
                                        className="w-full px-3 py-2 pl-10 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    />
                                    <i className="ph ph-magnifying-glass absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400"></i>
                                </div>
                            </div>

                            <div className="max-h-60 overflow-y-auto mb-4">
                                {loading ? (
                                    <div className="p-4 text-center">
                                        <div className="animate-spin inline-block w-6 h-6 border-3 border-primary border-t-transparent rounded-full"></div>
                                    </div>
                                ) : customers.length > 0 ? (
                                    <div className="space-y-2">
                                        {customers.map(customer => (
                                            <div
                                                key={customer.id}
                                                className="p-3 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer"
                                                onClick={() => handleSelectCustomer(customer)}
                                            >
                                                <div className="flex items-center gap-3">
                                                    <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                                                        <i className="ph ph-user text-blue-600"></i>
                                                    </div>
                                                    <div>
                                                        <h4 className="font-medium">{customer.name}</h4>
                                                        <p className="text-sm text-gray-600">{customer.phone}</p>
                                                    </div>
                                                    {customer.orderCount > 0 && (
                                                        <div className="ml-auto text-right">
                                                            <span className="text-sm text-gray-600">{customer.orderCount} orders</span>
                                                            <p className="text-sm font-medium">{UserSession?.getCurrency()}{customer.totalSpent}</p>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : searchTerm.length >= 2 ? (
                                    <div className="p-4 text-center text-gray-500">
                                        No customers found
                                    </div>
                                ) : (
                                    <div className="p-4 text-center text-gray-500">
                                        Type at least 2 characters to search
                                    </div>
                                )}
                            </div>

                            <button
                                className="w-full py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                                onClick={() => setShowAddForm(true)}
                            >
                                Add New Customer
                            </button>
                        </>
                    ) : (
                        <>
                            <div className="space-y-4 mb-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                        Name
                                    </label>
                                    <input
                                        type="text"
                                        value={newCustomer.name}
                                        onChange={e => setNewCustomer({ ...newCustomer, name: e.target.value })}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        placeholder="Enter customer name"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                        Phone
                                    </label>
                                    <input
                                        type="tel"
                                        value={newCustomer.phone}
                                        onChange={e => setNewCustomer({ ...newCustomer, phone: e.target.value })}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        placeholder="Enter phone number"
                                    />
                                </div>
                            </div>

                            <div className="flex gap-3">
                                <button
                                    className="flex-1 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                                    onClick={() => setShowAddForm(false)}
                                    disabled={loading}
                                >
                                    Cancel
                                </button>
                                <button
                                    className="flex-1 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                                    onClick={handleCreateCustomer}
                                    disabled={loading}
                                >
                                    {loading ? (
                                        <div className="animate-spin inline-block w-5 h-5 border-2 border-white border-t-transparent rounded-full"></div>
                                    ) : (
                                        'Create Customer'
                                    )}
                                </button>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}

// ProductFormModal updated with consistent layout and slide-in behavior
export function ProductFormModal({ isOpen, onClose, product = null }) {
    // Add addons state
    const [formData, setFormData] = useState({
        id: '',
        title: '',
        desc: '',
        cat: 'Food',
        imgs: [],
        price: '',
        mrp: '',
        active: true,
        veg: true,
        stock: 0,
        barcode: '',
        priceVariants: [],
        addons: [], // Add this line for addons
    });

    const [recipeItems, setRecipeItems] = useState([]);
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState('');
    const [charges, setCharges] = useState([
        { name: 'CGST', value: '2.5%', inclusive: true },
        { name: 'SGST', value: '2.5%', inclusive: true }
    ]);
    const [categories, setCategories] = useState([
        'Food', 'Beverages', 'Appetizers', 'Main Course', 'Desserts', 'Snacks'
    ]);
    const [previewImage, setPreviewImage] = useState('');
    const [showStockManagement, setShowStockManagement] = useState(false);
    const [deleteConfirmed, setDeleteConfirmed] = useState(false);
    const modalRef = useRef(null);

    // Detect if mobile
    const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

    useEffect(() => {
        const handleResize = () => setIsMobile(window.innerWidth < 768);
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    // Handle outside click to dismiss
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (modalRef.current && !modalRef.current.contains(event.target)) {
                onClose();
            }
        };

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isOpen, onClose]);

    // Reset form when modal opens
    useEffect(() => {
        if (isOpen) {
            setFormData({
                id: product?.id || '',
                title: product?.title || '',
                desc: product?.desc || '',
                cat: product?.cat || 'Food',
                imgs: product?.imgs || [],
                price: product?.price || '',
                mrp: product?.mrp || '',
                active: product?.active !== undefined ? product?.active : true,
                veg: product?.veg !== undefined ? product?.veg : true,
                stock: product?.stock || 0,
                barcode: product?.barcode || '',
                priceVariants: product?.priceVariants || [],
                addons: product?.addons || [], // Add this line for addons
            });

            setRecipeItems(product?.recipeItems || []);

            // If product has charges, use them; otherwise set default GST rates
            if (product?.charges && product.charges.length > 0) {
                // Convert existing charges to the format expected by the form
                const existingCharges = product.charges.map(c => ({
                    name: c.name,
                    value: c.type === 'percentage' ? `${c.value}%` : String(c.value),
                    inclusive: c.inclusive
                }));

                // Check if we have both CGST and SGST
                const hasCGST = existingCharges.some(c => c.name === 'CGST');
                const hasSGST = existingCharges.some(c => c.name === 'SGST');

                if (hasCGST && hasSGST) {
                    // Use existing charges as-is
                    setCharges(existingCharges);
                } else {
                    // Add standard GST if missing
                    const updatedCharges = [...existingCharges];

                    if (!hasCGST) {
                        updatedCharges.push({ name: 'CGST', value: '2.5%', inclusive: true });
                    }

                    if (!hasSGST) {
                        updatedCharges.push({ name: 'SGST', value: '2.5%', inclusive: true });
                    }

                    setCharges(updatedCharges);
                }
            } else {
                // Default GST rates for food items (5% total - split as 2.5% CGST and 2.5% SGST)
                setCharges([
                    { name: 'CGST', value: '2.5%', inclusive: true },
                    { name: 'SGST', value: '2.5%', inclusive: true }
                ]);
            }

            setShowStockManagement(product?.stock !== undefined);
            setUploading(false);
            setError('');
            setDeleteConfirmed(false);

            if (product?.imgs && product?.imgs.length > 0) {
                setPreviewImage(product.imgs[0]);
            } else {
                setPreviewImage('');
            }
        }
    }, [isOpen, product]);

    // Fetch categories from existing products
    useEffect(() => {
        async function fetchCategories() {
            try {
                const snapshot = await sdk.db.collection("Product").get();
                // Start with default categories plus popular food categories
                const cats = new Set([
                    'Appetizers', 'Main Course', 'Breakfast', 'Desserts', 'Beverages',
                    'Soups', 'Salads', 'Rice', 'Noodles', 'Pizza', 'Burgers', 'Sandwiches',
                    'Wraps', 'Pasta', 'Biryani', 'Snacks', 'Combos', 'Thalis'
                ]);

                snapshot.docs.forEach(doc => {
                    const data = doc.data();
                    if (data.cat) {
                        cats.add(data.cat);
                    }
                });

                setCategories(Array.from(cats).sort());
            } catch (error) {
                console.error("Error fetching categories:", error);
            }
        }

        if (isOpen) {
            fetchCategories();
        }
    }, [isOpen]);

    const handleFormChange = (field, value) => {
        setFormData(prevData => ({
            ...prevData,
            [field]: value
        }));
    };

    // Handle input change for text fields
    const handleChange = (e) => {
        const { name, value, type, checked } = e.target;

        // Handle different input types
        if (type === 'checkbox') {
            handleFormChange(name, checked);
        } else {
            handleFormChange(name, value);
        }
    };

    const handleImageUpload = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        try {
            setUploading(true);
            setError(null);

            // Preview image immediately for better UX
            const reader = new FileReader();
            reader.onload = async (e) => {
                const result = e.target.result;
                setPreviewImage(result);

                try {
                    // Generate a temporary ID if this is a new product
                    const productId = formData.id || `temp_${Date.now()}`;

                    // Create a unique filename with timestamp to avoid conflicts
                    const timestamp = Date.now();
                    const fileName = `main_${timestamp}.jpg`;
                    const filePath = `products/${productId}/${fileName}`;

                    // Upload the file to Firebase Storage
                    await sdk.storage.uploadFile(filePath, file);

                    // Get the download URL
                    const imageUrl = await sdk.storage.getDownloadURL(filePath);

                    // Update form data with the new image URL
                    setFormData(prev => ({
                        ...prev,
                        imgs: [...prev.imgs, imageUrl]
                    }));

                    setUploading(false);
                    showToast('Image uploaded successfully', 'success');
                } catch (error) {
                    console.error('Error uploading image:', error);
                    setError('Failed to upload image to storage');
                    setUploading(false);
                }
            };

            reader.readAsDataURL(file);
        } catch (error) {
            console.error('Error uploading image:', error);
            setError('Failed to upload image');
            setUploading(false);
        }
    };

    const handleBarcodeScanner = async () => {
        // In a real implementation, you would integrate with a barcode scanner library
        // For this example, we'll simulate a scanned barcode
        try {
            // Simulate a barcode scanning delay
            const simulatedBarcode = "PROD" + Math.floor(1000000 + Math.random() * 9000000);

            setFormData(prev => ({
                ...prev,
                barcode: simulatedBarcode
            }));

            showToast("Barcode scanned successfully");
        } catch (error) {
            setError('Failed to scan barcode');
        }
    };

    const updateCharge = (index, updatedCharge) => {
        console.log("Updating charge at index", index, "with", updatedCharge);
        const updatedCharges = [...charges];

        if (index < updatedCharges.length) {
            updatedCharges[index] = updatedCharge;
        } else {
            updatedCharges.push(updatedCharge);
        }

        // Only filter charges when actually saving the form, not during editing
        // This allows users to work with empty or zero-value charges during editing
        setCharges(updatedCharges);

        console.log("Updated charges:", updatedCharges);
    };

    const removeImage = async (index) => {
        try {
            // Get the image URL that's being removed
            const imageToRemove = formData.imgs[index];

            // If it's a Firebase Storage URL, try to delete the file
            if (imageToRemove && imageToRemove.includes('firebasestorage.googleapis.com')) {
                // Extract the path from the URL
                const urlParts = imageToRemove.split('/o/')[1];
                if (urlParts) {
                    const path = decodeURIComponent(urlParts.split('?')[0]);
                    try {
                        await sdk.storage.deleteFile(path);
                        showToast('Image deleted from storage', 'success');
                    } catch (deleteError) {
                        console.warn('Could not delete image from storage:', deleteError);
                        // Continue with UI update even if delete fails
                    }
                }
            }

            // Update the form data
            setFormData(prev => {
                const updatedImgs = [...prev.imgs];
                updatedImgs.splice(index, 1);
                return { ...prev, imgs: updatedImgs };
            });

            // Update preview image
            if (index === 0 && formData.imgs.length > 1) {
                setPreviewImage(formData.imgs[1]);
            } else if (formData.imgs.length <= 1) {
                setPreviewImage('');
            }
        } catch (error) {
            console.error('Error removing image:', error);
            showToast('Failed to remove image', 'error');
        }
    };

    // Handle form submission
    const handleSubmit = async () => {
        if (!formData.title || !formData.price || !formData.mrp || !formData.cat) {
            setError('All fields marked with * are required.');
            return;
        }

        // Validate numeric fields
        if (isNaN(Number(formData.price)) || Number(formData.price) < 0) {
            setError('Please enter a valid selling price.');
            return;
        }

        if (isNaN(Number(formData.mrp)) || Number(formData.mrp) < 0) {
            setError('Please enter a valid MRP.');
            return;
        }

        // Validate addons
        const invalidAddons = formData.addons.filter(addon =>
            addon.name.trim() !== '' && (isNaN(Number(addon.price)) || Number(addon.price) < 0)
        );
        if (invalidAddons.length > 0) {
            setError('Please enter valid prices for all add-ons.');
            return;
        }

        setUploading(true);
        setError('');

        try {
            // Create product data with combined fields
            const productData = {
                title: formData.title.trim(),
                desc: formData.desc.trim(),
                cat: formData.cat,
                price: Number(formData.price),
                mrp: Number(formData.mrp),
                active: formData.active,
                veg: formData.veg,
                imgs: formData.imgs || [],
                barcode: formData.barcode ? formData.barcode.trim() : '',
                stock: showStockManagement ? Number(formData.stock) : undefined,
                // Serialize price variants
                priceVariants: (formData.priceVariants || []).map(variant => ({
                    id: variant.id || Date.now().toString(),
                    name: variant.name.trim(),
                    price: Number(variant.price),
                    isDefault: Boolean(variant.isDefault)
                })),
                // Serialize addons
                addons: (formData.addons || [])
                    .filter(addon => addon.name.trim() !== '')
                    .map(addon => ({
                        id: addon.id || Date.now().toString(),
                        name: addon.name.trim(),
                        price: Number(addon.price),
                        inStock: Boolean(addon.inStock)
                    })),
                // Serialize charges - properly handle GST and other taxes
                charges: charges.filter(charge => {
                    const numValue = parseFloat(String(charge.value).replace('%', ''));
                    return charge.name.trim() !== '' && !isNaN(numValue) && numValue > 0;
                }).map(charge => {
                    const isPercentage = String(charge.value).includes('%');
                    const numValue = parseFloat(String(charge.value).replace('%', ''));
                    return {
                        name: charge.name.trim(),
                        value: numValue,
                        type: isPercentage ? 'percentage' : 'fixed',
                        inclusive: Boolean(charge.inclusive)
                    };
                }),
                // Serialize recipe items
                recipe: (recipeItems || []).map(item => ({
                    id: item.id || Date.now().toString(),
                    name: item.name.trim(),
                    quantity: Number(item.quantity),
                    unit: item.unit
                })),
                updatedAt: new Date()
            };

            // Get current user profile
            try {
                const profileDoc = await sdk.profile.get();
                const userProfile = profileDoc.data();

                if (userProfile) {
                    productData.sellerId = userProfile.uid || '';
                    productData.sellerBusinessName = userProfile.businessName || '';
                    productData.sellerAvatar = userProfile.photoURL || '';
                }
            } catch (profileError) {
                console.error('Error getting profile data:', profileError);
                // Continue without profile data
            }

            let productId;

            // Save to Firestore
            if (product) {
                // Update existing product
                productId = product.id;
                await sdk.db.collection("Product").doc(productId).update(productData);
                showToast('Product updated successfully');
            } else {
                // Create new product
                const docRef = await sdk.db.collection("Product").add(productData);
                productId = docRef.id;
                showToast('Product created successfully');
            }

            // Track analytics event
            if (sdk.analytics) {
                sdk.analytics.logEvent(product ? 'product_updated' : 'product_created', {
                    product_id: productId,
                    product_name: productData.title,
                    category: productData.cat
                });
            }

            setUploading(false);
            onClose();

            // Refresh products list if the function exists
            if (refreshProducts && typeof refreshProducts === 'function') {
                refreshProducts();
            }
        } catch (error) {
            console.error('Error saving product:', error);
            setError(`Failed to save product: ${error.message || 'Unknown error'}`);
            setUploading(false);
        }
    };

    // Handle product deletion
    const handleDelete = async () => {
        // Only allow deletion of existing products
        if (!product || !product.id) {
            setError('Cannot delete a product that has not been saved yet.');
            return;
        }

        // If not confirmed via checkbox, remind user
        if (!deleteConfirmed) {
            setError('Please check the confirmation box before deleting.');
            return;
        }

        // Final confirmation
        if (!confirm(`Are you absolutely sure you want to delete "${product.title}"? This action cannot be undone and the product will be permanently removed from your inventory.`)) {
            return;
        }

        // Proceed with deletion
        try {
            setUploading(true);
            setError('');

            // First delete all product images from storage if they exist
            if (formData.imgs && formData.imgs.length > 0) {
                try {
                    const files = await sdk.storage.listFiles(`products/${product.id}`);

                    // Delete each file
                    for (const item of files.items) {
                        try {
                            await sdk.storage.deleteFile(item.fullPath);
                            console.log(`Deleted image: ${item.fullPath}`);
                        } catch (deleteError) {
                            console.warn(`Could not delete image: ${item.fullPath}`, deleteError);
                            // Continue with deletion of other files
                        }
                    }
                } catch (listError) {
                    console.warn('Could not list images for deletion:', listError);
                    // Continue with document deletion regardless
                }
            }

            // Then delete the product document
            await sdk.db.collection("Product").doc(product.id).delete();

            // Track product deletion with analytics
            if (sdk.analytics) {
                sdk.analytics.logEvent('product_deleted', {
                    product_id: product.id,
                    product_name: product.title,
                    category: product.category || 'uncategorized'
                });
            }

            showToast('Product deleted successfully');
            setUploading(false);
            onClose();

            // Refresh products list if the function exists
            if (refreshProducts && typeof refreshProducts === 'function') {
                refreshProducts();
            }
        } catch (error) {
            console.error('Error deleting product:', error);
            setError('Failed to delete product. Please try again.');
            setUploading(false);
        }
    };

    // Handle addon operations
    const handleAddAddon = () => {
        setFormData(prev => ({
            ...prev,
            addons: [...prev.addons, {
                id: Date.now().toString(),
                name: '',
                price: '',
                inStock: true
            }]
        }));
    };

    const handleUpdateAddon = (index, field, value) => {
        setFormData(prev => {
            const newAddons = [...prev.addons];
            newAddons[index] = {
                ...newAddons[index],
                [field]: field === 'price' ? (value === '' ? '' : Number(value)) : value
            };
            return {
                ...prev,
                addons: newAddons
            };
        });
    };

    const handleRemoveAddon = (index) => {
        setFormData(prev => ({
            ...prev,
            addons: prev.addons.filter((_, i) => i !== index)
        }));
    };

    if (!isOpen) return null;

    // Get modal classes based on device type
    const modalClasses = isMobile
        ? "fixed inset-x-0 bottom-0 z-50 rounded-t-xl bg-white shadow-xl animate-slideUp max-h-[90vh] overflow-auto"
        : "fixed top-0 right-0 bottom-0 z-50 bg-white shadow-xl animate-slideInRight w-full max-w-2xl overflow-auto";

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-40 flex items-end md:items-center justify-end transition-opacity">
            <div ref={modalRef} className={modalClasses}>
                {/* Mobile drag handle - only show on mobile */}
                {isMobile && (
                    <div className="flex justify-center pt-2 pb-1">
                        <div className="w-10 h-1 bg-gray-300 rounded-full"></div>
                    </div>
                )}

                {/* Header */}
                <div className="sticky top-0 z-10 px-4 py-3 bg-red-50 border-b border-gray-200 flex items-center justify-between">
                    <h2 className="text-xl font-semibold text-gray-800">
                        {product ? 'Edit Product' : 'Add New Product'}
                    </h2>
                    <button
                        onClick={onClose}
                        className="p-2 rounded-full hover:bg-red-100 transition-colors"
                    >
                        <i className="ph ph-x text-gray-600 text-lg"></i>
                    </button>
                </div>

                {/* Form Content - Scrollable */}
                <div className="p-4 overflow-y-auto">
                    {error && (
                        <div className="mb-4 p-3 bg-red-100 text-red-700 rounded-lg">
                            {error}
                        </div>
                    )}

                    <form className="space-y-5">
                        {/* Product Image Upload */}
                        <div>
                            <div className="mb-1 flex justify-between items-center">
                                <label className="block text-sm font-medium text-gray-700">
                                    Product Images
                                </label>
                                <label className="cursor-pointer inline-flex items-center justify-center px-3 py-1.5 text-xs font-medium text-white bg-red-500 rounded-lg hover:bg-red-600 transition-colors">
                                    <i className="ph ph-plus mr-1"></i>
                                    <span>{uploading ? 'Uploading...' : 'Add Image'}</span>
                                    <input
                                        type="file"
                                        className="hidden"
                                        onChange={handleImageUpload}
                                        accept="image/*"
                                        disabled={uploading}
                                    />
                                </label>
                            </div>

                            {formData.imgs.length > 0 ? (
                                <div className="grid grid-cols-3 gap-2 mt-2 mb-2">
                                    {formData.imgs.map((img, index) => (
                                        <div key={index} className="relative rounded-lg border border-gray-200 overflow-hidden aspect-square">
                                            <img
                                                src={img}
                                                alt={`Product ${index + 1}`}
                                                className="w-full h-full object-cover"
                                                onClick={() => setPreviewImage(img)}
                                            />
                                            {img === previewImage && (
                                                <div className="absolute inset-0 bg-red-500 bg-opacity-20 flex items-center justify-center">
                                                    <span className="px-2 py-1 bg-red-500 text-white text-xs rounded">Main</span>
                                                </div>
                                            )}
                                            <button
                                                type="button"
                                                onClick={() => removeImage(index)}
                                                className="absolute top-1 right-1 bg-red-500 text-white p-1 rounded-full"
                                            >
                                                <i className="ph ph-x text-sm"></i>
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="w-full border-2 border-dashed border-gray-300 rounded-lg p-4 text-center">
                                    <div className="flex flex-col items-center justify-center py-6">
                                        <i className="ph ph-image text-4xl text-gray-400 mb-2"></i>
                                        <p className="text-gray-500">No product images</p>
                                        <p className="text-xs text-gray-400 mt-1">Click "Add Image" to upload</p>
                                    </div>
                                </div>
                            )}

                            {previewImage && (
                                <div className="mt-3 bg-gray-50 p-3 rounded-lg">
                                    <div className="text-sm font-medium text-gray-700 mb-2">Preview Image</div>
                                    <img
                                        src={previewImage}
                                        alt="Product preview"
                                        className="mx-auto max-h-48 object-contain"
                                    />
                                </div>
                            )}
                        </div>

                        {/* Category Selection */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Category <span className="text-red-500">*</span>
                            </label>
                            <select
                                name="cat"
                                value={formData.cat}
                                onChange={handleChange}
                                className="w-full p-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500"
                            >
                                {categories.map((category, index) => (
                                    <option key={index} value={category}>
                                        {category}
                                    </option>
                                ))}
                            </select>
                        </div>

                        {/* Product Title */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Product Title <span className="text-red-500">*</span>
                            </label>
                            <input
                                type="text"
                                name="title"
                                value={formData.title}
                                onChange={handleChange}
                                className="w-full p-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500"
                                placeholder="Enter product name"
                            />
                        </div>

                        {/* Barcode */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Barcode ID
                            </label>
                            <div className="relative">
                                <input
                                    type="text"
                                    name="barcode"
                                    value={formData.barcode}
                                    onChange={handleChange}
                                    className="w-full p-2.5 pr-10 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500"
                                    placeholder="Enter barcode"
                                />
                                <button
                                    type="button"
                                    onClick={handleBarcodeScanner}
                                    className="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-500 hover:text-red-500"
                                >
                                    <i className="ph ph-barcode text-xl"></i>
                                </button>
                            </div>
                        </div>

                        {/* Description */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Description
                            </label>
                            <textarea
                                name="desc"
                                value={formData.desc}
                                onChange={handleChange}
                                className="w-full p-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500"
                                placeholder="Enter product description"
                                rows="3"
                            ></textarea>
                        </div>

                        {/* Pricing Section */}
                        <div>
                            <h3 className="text-md font-medium text-gray-700 mb-3">Pricing</h3>
                            <div className="grid grid-cols-2 gap-4">
                                {/* MRP */}
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                        MRP ({UserSession?.getCurrency()}) <span className="text-red-500">*</span>
                                    </label>
                                    <div className="mt-1 relative rounded-md shadow-sm">
                                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                            <span className="text-gray-500 sm:text-sm">{UserSession?.getCurrency()}</span>
                                        </div>
                                        <input
                                            type="text"
                                            name="mrp"
                                            value={formData.mrp}
                                            onChange={handleChange}
                                            className="w-full pl-8 p-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500"
                                            placeholder="0"
                                        />
                                    </div>
                                </div>

                                {/* Selling Price */}
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                        Selling Price ({UserSession?.getCurrency()}) <span className="text-red-500">*</span>
                                    </label>
                                    <div className="mt-1 relative rounded-md shadow-sm">
                                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                            <span className="text-gray-500 sm:text-sm">{UserSession?.getCurrency()}</span>
                                        </div>
                                        <input
                                            type="text"
                                            name="price"
                                            value={formData.price}
                                            onChange={handleChange}
                                            className="w-full pl-8 p-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500"
                                            placeholder="0"
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Price Calculation Display */}
                            {formData.mrp && formData.price && (
                                <div className="flex items-center mt-2 text-sm">
                                    <span className="mr-2">Price:</span>
                                    {Number(formData.mrp) > Number(formData.price) && (
                                        <span className="line-through text-gray-500 mr-2">{UserSession?.getCurrency()}{formData.mrp}</span>
                                    )}
                                    <span className="font-medium">{UserSession?.getCurrency()}{formData.price}</span>
                                    {Number(formData.mrp) > Number(formData.price) && (
                                        <span className="ml-2 text-green-600">
                                            ({Math.round(((Number(formData.mrp) - Number(formData.price)) / Number(formData.mrp)) * 100)}% OFF)
                                        </span>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Price Variants */}
                        <div>
                            <div className="flex items-center justify-between mb-1">
                                <h3 className="text-sm font-medium text-gray-700">Additional Price Variants</h3>
                            </div>
                            <PriceVariants
                                variants={formData.priceVariants || []}
                                setVariants={(variants) => handleFormChange('priceVariants', variants)}
                            />
                        </div>

                        {/* Add-ons Section */}
                        <div>
                            <div className="flex items-center justify-between mb-3">
                                <h3 className="text-sm font-medium text-gray-700">Add-ons</h3>
                                <button
                                    type="button"
                                    onClick={handleAddAddon}
                                    className="inline-flex items-center px-2.5 py-1.5 text-xs font-medium text-white bg-red-500 rounded hover:bg-red-600 transition-colors"
                                >
                                    <i className="ph ph-plus mr-1"></i>
                                    Add Option
                                </button>
                            </div>

                            {formData.addons.length === 0 ? (
                                <div className="text-center py-4 bg-gray-50 rounded-lg">
                                    <i className="ph ph-puzzle-piece text-2xl text-gray-400"></i>
                                    <p className="text-sm text-gray-500 mt-1">No add-ons added yet</p>
                                    <p className="text-xs text-gray-400">Add options like "Extra Cheese", "Toppings", etc.</p>
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    {formData.addons.map((addon, index) => (
                                        <div key={addon.id} className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg">
                                            <div className="flex-1">
                                                <input
                                                    type="text"
                                                    value={addon.name}
                                                    onChange={(e) => handleUpdateAddon(index, 'name', e.target.value)}
                                                    placeholder="Add-on name"
                                                    className="w-full p-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500"
                                                />
                                            </div>
                                            <div className="w-24">
                                                <div className="relative">
                                                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                                        <span className="text-gray-500 sm:text-sm">{UserSession?.getCurrency()}</span>
                                                    </div>
                                                    <input
                                                        type="number"
                                                        value={addon.price}
                                                        onChange={(e) => handleUpdateAddon(index, 'price', e.target.value)}
                                                        placeholder="0"
                                                        className="w-full pl-7 p-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500"
                                                    />
                                                </div>
                                            </div>
                                            <div>
                                                <button
                                                    type="button"
                                                    onClick={() => handleUpdateAddon(index, 'inStock', !addon.inStock)}
                                                    className={`p-2 rounded-lg transition-colors ${addon.inStock ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-400'}`}
                                                    title={addon.inStock ? 'In Stock' : 'Out of Stock'}
                                                >
                                                    <i className="ph ph-check"></i>
                                                </button>
                                            </div>
                                            <div>
                                                <button
                                                    type="button"
                                                    onClick={() => handleRemoveAddon(index)}
                                                    className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                                                >
                                                    <i className="ph ph-trash"></i>
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Veg/Non-veg Toggle */}
                        <div className="flex items-center justify-between bg-gray-50 p-3 rounded-lg">
                            <div className="flex items-center space-x-2">
                                <div className={`h-6 w-6 border-2 p-0.5 ${formData.veg ? 'border-green-500' : 'border-red-500'}`}>
                                    <div className={`h-full w-full rounded-sm ${formData.veg ? 'bg-green-500' : 'bg-red-500'}`}></div>
                                </div>
                                <span className="text-sm font-medium text-gray-800">
                                    {formData.veg ? 'Vegetarian' : 'Non-vegetarian'}
                                </span>
                            </div>
                            <label className="relative inline-flex items-center cursor-pointer">
                                <input
                                    type="checkbox"
                                    name="veg"
                                    checked={formData.veg}
                                    onChange={handleChange}
                                    className="sr-only peer"
                                />
                                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-red-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-500"></div>
                            </label>
                        </div>

                        {/* Stock Management Toggle */}
                        <div className="bg-gray-50 p-3 rounded-lg">
                            <div className="flex items-center mb-2">
                                <input
                                    type="checkbox"
                                    id="enableStock"
                                    className="w-4 h-4 text-red-600 border-gray-300 rounded focus:ring-red-500"
                                    checked={showStockManagement}
                                    onChange={(e) => {
                                        setShowStockManagement(e.target.checked);
                                        handleFormChange('stock', e.target.checked ? 0 : undefined);
                                    }}
                                />
                                <label htmlFor="enableStock" className="ml-2 text-sm font-medium text-gray-700">
                                    Enable Stock Management
                                </label>
                            </div>

                            {showStockManagement && (
                                <div className="mt-2 space-y-4">
                                    <div className="flex items-center space-x-2">
                                        <div className="w-1/2">
                                            <label className="block text-xs font-medium text-gray-700 mb-1">
                                                Current Stock
                                            </label>
                                            <input
                                                type="number"
                                                value={formData.stock}
                                                min="0"
                                                onChange={(e) => handleFormChange('stock', Math.max(0, Number(e.target.value)))}
                                                className="w-full p-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500"
                                            />
                                        </div>
                                    </div>

                                    {/* Recipe Items Component */}
                                    <RecipeItems
                                        items={recipeItems}
                                        setItems={setRecipeItems}
                                    />
                                </div>
                            )}
                        </div>

                        {/* Tax & Charges */}
                        <div className="p-3 bg-gray-50 rounded-lg">
                            <h4 className="text-sm font-medium text-gray-700 mb-3">Tax & Charges</h4>

                            <div className="mb-3 text-xs text-gray-600 p-2 bg-blue-50 rounded-lg">
                                <p className="font-medium text-blue-700 mb-1">GST Information</p>
                                <p>• For food items, standard GST is 5% (2.5% CGST + 2.5% SGST)</p>
                                <p>• For other categories, check the applicable GST rates</p>
                                <p className="mt-1">
                                    <strong className="text-green-600">Inclusive:</strong> Price already includes tax (recommended)
                                    <span className="block text-xs ml-4 mt-0.5">Example: ₹100 item with 5% inclusive GST = ₹95.24 base + ₹4.76 tax</span>
                                </p>
                                <p className="mt-1">
                                    <strong className="text-red-600">Exclusive:</strong> Tax will be added to the listed price
                                    <span className="block text-xs ml-4 mt-0.5">Example: ₹100 item with 5% exclusive GST = ₹100 base + ₹5 tax = ₹105 total</span>
                                </p>
                            </div>

                            {charges.map((charge, index) => (
                                <div key={index} className="mb-3 last:mb-0">
                                    <div className="flex gap-2 mb-2">
                                        <input
                                            type="text"
                                            value={charge.name}
                                            onChange={(e) => {
                                                const updatedCharge = { ...charge, name: e.target.value };
                                                updateCharge(index, updatedCharge);
                                            }}
                                            placeholder="Charge name"
                                            className="flex-1 p-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500"
                                        />
                                        <div className="relative flex-1">
                                            <input
                                                type="text"
                                                value={String(charge.value).replace('%', '')}
                                                onChange={(e) => {
                                                    const value = e.target.value.replace(/[^0-9.]/g, '');
                                                    const updatedCharge = {
                                                        ...charge,
                                                        value: String(charge.value).includes('%') ? `${value}%` : value
                                                    };
                                                    updateCharge(index, updatedCharge);
                                                }}
                                                placeholder="Value"
                                                className="w-full p-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500"
                                            />
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    const isPercentage = String(charge.value).includes('%');
                                                    const value = String(charge.value).replace('%', '');
                                                    const updatedCharge = {
                                                        ...charge,
                                                        value: isPercentage ? value : `${value}%`
                                                    };
                                                    updateCharge(index, updatedCharge);
                                                }}
                                                className={`absolute right-0 top-0 bottom-0 px-3 rounded-r-lg flex items-center justify-center ${String(charge.value).includes('%')
                                                    ? 'bg-red-100 text-red-600'
                                                    : 'bg-green-100 text-green-600'
                                                    }`}
                                            >
                                                {String(charge.value).includes('%') ? '%' : UserSession?.getCurrency()}
                                            </button>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                const updatedCharges = charges.filter((_, i) => i !== index);
                                                setCharges(updatedCharges);
                                            }}
                                            className="p-2 text-red-500 hover:text-red-600 hover:bg-red-50 rounded-lg"
                                            title="Delete charge"
                                        >
                                            <i className="ph ph-trash"></i>
                                        </button>
                                    </div>
                                    <div className="flex items-center">
                                        <label className="flex items-center cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={charge.inclusive}
                                                onChange={(e) => {
                                                    const updatedCharge = { ...charge, inclusive: e.target.checked };
                                                    updateCharge(index, updatedCharge);
                                                }}
                                                className="w-4 h-4 text-red-600 bg-gray-100 border-gray-300 rounded focus:ring-red-500"
                                            />
                                            <span className="ml-2 text-xs font-medium text-gray-700">Inclusive</span>
                                            <span className="ml-1 text-xs text-gray-500">(Price includes this tax)</span>
                                        </label>
                                    </div>
                                </div>
                            ))}

                            {/* Add new charge */}
                            <div className="flex gap-2 mt-3">
                                <button
                                    type="button"
                                    onClick={() => {
                                        updateCharge(charges.length, {
                                            name: '',
                                            value: '0%', // Initialize as string with % for consistency
                                            inclusive: true
                                        });
                                    }}
                                    className="flex-1 text-xs bg-gray-200 hover:bg-gray-300 text-gray-700 py-2 px-2 rounded flex items-center justify-center"
                                >
                                    <i className="ph ph-plus mr-1"></i> Add Custom Charge
                                </button>

                                <button
                                    type="button"
                                    onClick={() => {
                                        // Reset to standard GST rates
                                        setCharges([
                                            { name: 'CGST', value: '2.5%', inclusive: true },
                                            { name: 'SGST', value: '2.5%', inclusive: true }
                                        ]);
                                    }}
                                    className="flex-1 text-xs bg-blue-100 hover:bg-blue-200 text-blue-700 py-2 px-2 rounded flex items-center justify-center"
                                >
                                    <i className="ph ph-arrows-clockwise mr-1"></i> Reset to Standard GST
                                </button>
                            </div>
                        </div>

                        {/* Active Status */}
                        <div className="flex items-center justify-between bg-gray-50 p-3 rounded-lg">
                            <span className="text-sm font-medium text-gray-700">Product Status</span>
                            <label className="relative inline-flex items-center cursor-pointer">
                                <input
                                    type="checkbox"
                                    name="active"
                                    checked={formData.active}
                                    onChange={handleChange}
                                    className="sr-only peer"
                                />
                                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-red-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-red-500"></div>
                                <span className="ml-2 text-sm font-medium text-gray-700">
                                    {formData.active ? 'Active' : 'Inactive'}
                                </span>
                            </label>
                        </div>
                    </form>
                </div>

                {/* Danger Zone - Only show when editing an existing product */}
                {product && product.id && (
                    <div className="px-4 py-3 bg-red-50 border-t border-b border-red-100">
                        <div className="mb-2">
                            <h3 className="text-sm font-bold text-red-700 flex items-center">
                                <i className="ph ph-warning-circle mr-1.5"></i>
                                Danger Zone
                            </h3>
                            <p className="text-xs text-red-600 mt-1">
                                Deleting this product will permanently remove it. This action cannot be undone.
                            </p>
                        </div>

                        <div className="flex items-center mt-3">
                            <input
                                type="checkbox"
                                id="confirm-delete"
                                className="h-4 w-4 text-red-600 border-red-300 rounded mr-2"
                                checked={deleteConfirmed}
                                onChange={(e) => setDeleteConfirmed(e.target.checked)}
                            />
                            <label htmlFor="confirm-delete" className="text-xs text-red-700">
                                I understand that this action is permanent
                            </label>
                        </div>

                        <button
                            id="delete-product-btn"
                            type="button"
                            onClick={handleDelete}
                            disabled={!deleteConfirmed || uploading}
                            className="mt-3 px-3 py-1.5 text-xs text-red-700 border border-red-300 bg-white rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed hover:bg-red-100 flex items-center"
                        >
                            {uploading ? (
                                <span className="mr-2 h-3 w-3 rounded-full border-2 border-red-700 border-t-transparent animate-spin"></span>
                            ) : (
                                <i className="ph ph-trash mr-1.5"></i>
                            )}
                            Delete This Product
                        </button>
                    </div>
                )}

                {/* Form Actions - Sticky Footer */}
                <div className="sticky bottom-0 px-4 py-3 bg-white border-t flex justify-between gap-2">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                    >
                        Cancel
                    </button>

                    <button
                        type="button"
                        onClick={handleSubmit}
                        disabled={uploading}
                        className="px-4 py-2 text-sm font-medium text-white bg-red-500 hover:bg-red-600 rounded-lg transition-colors flex items-center"
                    >
                        {uploading ? (
                            <>
                                <span className="mr-2 h-4 w-4 rounded-full border-2 border-white border-t-transparent animate-spin"></span>
                                {product ? 'Updating...' : 'Saving...'}
                            </>
                        ) : (
                            <>
                                <i className="ph ph-floppy-disk mr-1"></i>
                                {product ? 'Update Product' : 'Save Product'}
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}

// Recipe Items Component for the Product Form
export function RecipeItems({ items, setItems }) {
    const [inventoryItems, setInventoryItems] = useState([]);
    const [loading, setLoading] = useState(true);

    // Fetch available inventory items when component mounts
    useEffect(() => {
        async function fetchInventoryItems() {
            try {
                setLoading(true);
                const inventorySnapshot = await sdk.db.collection("Inventory")
                    .orderBy("updatedAt", "desc")
                    .limit(100)
                    .get();

                // Process inventory items the same way as in Products.js
                const inventoryList = [];
                for (const doc of inventorySnapshot.docs) {
                    try {
                        const data = doc.data();
                        // Handle date conversions for Firestore Timestamps
                        const processedData = {
                            id: doc.id,
                            name: data.name || '',
                            quantity: Number(data.quantity || 0),
                            unit: data.unit || '',
                            minQuantity: Number(data.minQuantity || 0),
                            date: data.date?.toDate ? data.date.toDate() : new Date(),
                            updatedAt: data.updatedAt?.toDate ? data.updatedAt.toDate() : new Date(),
                            lastUpdated: data.lastUpdated || (data.updatedAt?.toDate ? data.updatedAt.toDate().toISOString() : new Date().toISOString())
                        };

                        const item = new InventoryItem(processedData);
                        if (item) {
                            inventoryList.push(item);
                        }
                    } catch (error) {
                        console.error(`Error creating inventory item from doc ${doc.id}:`, error);
                        // Continue with other inventory items
                    }
                }

                // Filter out duplicates based on name (just to be extra safe)
                const uniqueItems = [];
                const nameSet = new Set();

                // Log the total number of inventory items before deduplication
                console.log(`Total inventory items before deduplication: ${inventoryList.length}`);

                // Log each inventory item for debugging
                inventoryList.forEach((item, index) => {
                    console.log(`Inventory item ${index}:`, item.name, item.id);
                });

                // For now, use all items without deduplication
                setInventoryItems(inventoryList);

                // Log the final result
                console.log(`Set ${inventoryList.length} inventory items for the recipe dropdown`);

                setLoading(false);
            } catch (error) {
                console.error("Error fetching inventory items:", error);
                setLoading(false);
            }
        }

        fetchInventoryItems();
    }, []);

    const handleAddItem = () => {
        if (inventoryItems.length === 0) {
            showToast('No inventory items available. Please add items to inventory first.', 'error');
            return;
        }

        // Access properties correctly from InventoryItem object
        const firstItem = inventoryItems[0];
        const newItem = {
            id: Date.now().toString(), // Temporary ID for UI purposes
            name: firstItem.name,
            quantity: 1,
            unit: firstItem.unit
        };

        setItems([...items, newItem]);
    };

    const handleUpdateItem = (index, field, value) => {
        const updatedItems = [...items];

        if (field === 'name') {
            // When name changes, update the unit as well
            const selectedItem = inventoryItems.find(item => item.name === value);
            if (selectedItem) {
                updatedItems[index] = {
                    ...updatedItems[index],
                    name: value,
                    unit: selectedItem.unit
                };
            } else {
                updatedItems[index] = {
                    ...updatedItems[index],
                    name: value
                };
            }
        } else if (field === 'quantity') {
            // Ensure quantity is a positive number
            const quantity = Math.max(0, Number(value) || 0);
            updatedItems[index] = {
                ...updatedItems[index],
                quantity
            };
        }

        setItems(updatedItems);
    };

    const handleRemoveItem = (index) => {
        const updatedItems = [...items];
        updatedItems.splice(index, 1);
        setItems(updatedItems);
    };

    if (loading) {
        return (
            <div className="mt-4 p-4 bg-gray-50 rounded-lg">
                <div className="flex justify-center">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-red-500"></div>
                </div>
            </div>
        );
    }

    return (
        <div className="mt-4 p-4 bg-gray-50 rounded-lg">
            <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-medium text-gray-700">Recipe Items</h4>
                <div className="flex items-center gap-2">
                    {/* Removed reload button */}
                    <button
                        type="button"
                        onClick={handleAddItem}
                        className="text-xs bg-red-100 text-red-600 py-1 px-2 rounded flex items-center"
                    >
                        <i className="ph ph-plus mr-1"></i> Add Item
                    </button>
                </div>
            </div>

            {items.length === 0 ? (
                <p className="text-sm text-gray-500">No recipe items added yet</p>
            ) : (
                <div className="space-y-3">
                    {items.map((item, index) => (
                        <div key={index} className="flex items-center gap-2">
                            <div className="flex-grow">
                                <select
                                    value={item.name}
                                    onChange={(e) => handleUpdateItem(index, 'name', e.target.value)}
                                    className="w-full p-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500"
                                >
                                    {inventoryItems.map((invItem) => (
                                        <option key={invItem.id} value={invItem.name}>
                                            {invItem.name} ({invItem.quantity} {invItem.unit})
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className="w-28">
                                <div className="flex items-center">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            const currentValue = Number(item.quantity) || 0;
                                            if (currentValue > 0) {
                                                handleUpdateItem(index, 'quantity', currentValue - 1);
                                            }
                                        }}
                                        className="p-2 bg-red-500 text-white rounded-l-lg"
                                    >
                                        <i className="ph ph-minus"></i>
                                    </button>
                                    <input
                                        type="text"
                                        value={item.quantity}
                                        onChange={(e) => handleUpdateItem(index, 'quantity', e.target.value)}
                                        className="w-10 p-2 text-center border-y border-gray-300 focus:outline-none focus:ring-2 focus:ring-red-500"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => {
                                            const currentValue = Number(item.quantity) || 0;
                                            handleUpdateItem(index, 'quantity', currentValue + 1);
                                        }}
                                        className="p-2 bg-red-500 text-white rounded-r-lg"
                                    >
                                        <i className="ph ph-plus"></i>
                                    </button>
                                </div>
                            </div>
                            <div className="w-16 text-sm text-gray-600 text-center">
                                {item.unit}
                            </div>
                            <button
                                type="button"
                                onClick={() => handleRemoveItem(index)}
                                className="p-2 text-red-500 hover:bg-red-50 rounded-lg"
                            >
                                <i className="ph ph-trash"></i>
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

// Price Variants Component for the Product Form
export function PriceVariants({ variants, setVariants }) {
    // Predefined variation types
    const commonVariations = [
        { name: 'Half', icon: 'ph-circle-half' },
        { name: 'Full', icon: 'ph-circle' },
        { name: 'Regular', icon: 'ph-square' },
        { name: 'Large', icon: 'ph-square-logo' },
        { name: 'Small', icon: 'ph-square-half' }
    ];

    const handleAddVariant = (predefinedName = '') => {
        setVariants([
            ...variants,
            {
                id: Date.now().toString(),
                name: predefinedName || '',
                price: '',
                isDefault: variants.length === 0 // First variant is default
            }
        ]);
    };

    const handleUpdateVariant = (index, field, value) => {
        const updatedVariants = [...variants];

        if (field === 'price') {
            // Ensure price is a number
            value = value.replace(/[^0-9]/g, '');
        }

        // If updating isDefault, unset default for all other variants
        if (field === 'isDefault' && value === true) {
            updatedVariants.forEach(variant => variant.isDefault = false);
        }

        updatedVariants[index] = {
            ...updatedVariants[index],
            [field]: value
        };

        setVariants(updatedVariants);
    };

    const handleRemoveVariant = (index) => {
        const updatedVariants = [...variants];
        const removedVariant = updatedVariants[index];

        // If removing the default variant, set the first remaining variant as default
        if (removedVariant.isDefault && updatedVariants.length > 1) {
            const newDefaultIndex = index === 0 ? 1 : 0;
            updatedVariants[newDefaultIndex].isDefault = true;
        }

        updatedVariants.splice(index, 1);
        setVariants(updatedVariants);
    };

    return (
        <div className="mt-4 p-4 bg-gray-50 rounded-lg">
            <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-medium text-gray-700">Price Variants</h4>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => handleAddVariant()}
                        className="text-xs bg-red-100 text-red-600 py-1 px-2 rounded flex items-center"
                    >
                        <i className="ph ph-plus mr-1"></i> Custom Variant
                    </button>
                </div>
            </div>

            {/* Quick add common variations */}
            {variants.length === 0 && (
                <div className="mb-4">
                    <p className="text-sm text-gray-600 mb-2">Quick add common variations:</p>
                    <div className="flex flex-wrap gap-2">
                        {commonVariations.map((variation) => (
                            <button
                                key={variation.name}
                                onClick={() => handleAddVariant(variation.name)}
                                className="inline-flex items-center px-2 py-1 text-xs bg-white border border-gray-200 rounded-lg hover:bg-red-50 hover:border-red-200 transition-colors"
                            >
                                <i className={`ph ${variation.icon} mr-1 text-gray-600`}></i>
                                {variation.name}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {variants.length === 0 ? (
                <p className="text-sm text-gray-500">No price variants added yet</p>
            ) : (
                <div className="space-y-3">
                    {variants.map((variant, index) => (
                        <div key={index} className="flex items-center gap-2 bg-white p-2 rounded-lg border border-gray-200">
                            <div className="flex-grow">
                                <input
                                    type="text"
                                    placeholder="Variant Name (e.g. Half, Full)"
                                    value={variant.name}
                                    onChange={(e) => handleUpdateVariant(index, 'name', e.target.value)}
                                    className="w-full p-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500"
                                />
                            </div>
                            <div className="w-28">
                                <div className="flex items-center">
                                    <span className="p-2 bg-gray-100 border border-gray-300 rounded-l-lg">{UserSession?.getCurrency()}</span>
                                    <input
                                        type="text"
                                        placeholder="Price"
                                        value={variant.price}
                                        onChange={(e) => handleUpdateVariant(index, 'price', e.target.value)}
                                        className="w-full p-2 text-center border-y border-r border-gray-300 rounded-r-lg focus:outline-none focus:ring-2 focus:ring-red-500"
                                    />
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => handleUpdateVariant(index, 'isDefault', true)}
                                    className={`p-1.5 rounded-lg transition-colors ${variant.isDefault ? 'bg-green-100 text-green-600' : 'text-gray-400 hover:bg-gray-100'}`}
                                    title={variant.isDefault ? 'Default variant' : 'Set as default variant'}
                                >
                                    <i className="ph ph-star"></i>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleRemoveVariant(index)}
                                    className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg"
                                    title="Remove variant"
                                >
                                    <i className="ph ph-trash"></i>
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {variants.length > 0 && (
                <div className="mt-3 text-xs text-gray-500">
                    <p className="flex items-center">
                        <i className="ph ph-info mr-1"></i>
                        Click the <i className="ph ph-star mx-1 text-gray-400"></i> icon to set a variant as default
                    </p>
                </div>
            )}
        </div>
    );
}

// Context Menu Component
export function ContextMenu() {
    return (
        <div className="relative" ref={menuRef}>
            <button
                className="p-2 hover:bg-gray-100 rounded-full"
                onClick={() => setIsMenuOpen(!isMenuOpen)}
            >
                <i className="ph ph-dots-three-vertical text-xl"></i>
            </button>
            {isMenuOpen && renderContextMenu()}
        </div>
    );
}

export const renderContextMenu = () => {
    return (
        <div
            ref={menuRef}
            className="absolute right-0 top-12 w-52 bg-white rounded-lg shadow-lg border border-gray-200 overflow-hidden z-50"
        >
            <div className="py-1">
                {/* Removed printer management/disconnect button */}
                <button
                    className="w-full text-left px-4 py-3 text-gray-700 hover:bg-gray-50 flex items-center gap-3"
                    onClick={() => {
                        setIsMenuOpen(false);
                        handleShowQR();
                    }}
                >
                    <i className="ph ph-qr-code text-red-500"></i>
                    <span>Show QR Code</span>
                </button>

                <button
                    className="w-full text-left px-4 py-3 text-gray-700 hover:bg-gray-50 flex items-center gap-3"
                    onClick={() => {
                        if (confirm(`Are you sure you want to delete all orders for ${tableId || variant}?`)) {
                            confirmDelete();
                        }
                        setIsMenuOpen(false);
                    }}
                >
                    <i className="ph ph-trash text-red-500"></i>
                    <span>Clear All Orders</span>
                </button>

                <button
                    className="w-full text-left px-4 py-3 text-gray-700 hover:bg-gray-50 flex items-center gap-3"
                    onClick={() => {
                        setIsMenuOpen(false);
                        showRenameRoomModal(tableId, variant);
                    }}
                >
                    <i className="ph ph-pencil-simple text-red-500"></i>
                    <span>Rename {tableId ? 'Table' : 'Channel'}</span>
                </button>

                {tableId && (
                    <button
                        className="w-full text-left px-4 py-3 text-gray-700 hover:bg-gray-50 flex items-center gap-3"
                        onClick={() => {
                            if (confirm(`Are you sure you want to delete table ${tableId}?`)) {
                                deleteTable(tableId);
                                handleClose();
                            }
                            setIsMenuOpen(false);
                        }}
                    >
                        <i className="ph ph-trash text-red-500"></i>
                        <span>Delete Table</span>
                    </button>
                )}
            </div>
        </div>
    );
};
