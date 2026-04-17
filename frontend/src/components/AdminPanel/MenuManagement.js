import React, { useState, useEffect, useMemo } from 'react';
import { adminAPI, resolveApiAssetUrl } from '../../services/api';
import { getSuggestedMenuImageUrl } from '../../utils/menuImage';
import { useDialog } from '../common/DialogProvider';
import { isVolumeUnit } from '../../utils/units';
import DataTable from '../common/DataTable';

const formatAr = (value) => {
  const amount = Number(value || 0);
  return `${amount.toLocaleString('fr-FR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })} Ar`;
};

const normalizeText = (value) => String(value || '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim();

const isCocktailCategory = (category) => normalizeText(category) === 'cocktail';
const createIngredientRowId = () => `ingredient-row-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const createIngredientSelection = (overrides = {}) => ({
  row_id: createIngredientRowId(),
  ingredient_id: '',
  quantity_needed: 1,
  quantity_ml: null,
  name: '',
  ...overrides,
});

const MenuManagement = () => {
  const { confirm } = useDialog();
  const [menus, setMenus] = useState([]);
  const [ingredients, setIngredients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingMenu, setEditingMenu] = useState(null);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    price: 0,
    category: 'main',
    image_url: '',
    is_available: true,
    ingredients: [],
  });
  const [selectedImageFile, setSelectedImageFile] = useState(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState('');
  const [selectedIngredients, setSelectedIngredients] = useState([]);
  const [openIngredientDropdownId, setOpenIngredientDropdownId] = useState(null);
  const [ingredientSearchByRow, setIngredientSearchByRow] = useState({});
  const [message, setMessage] = useState('');

  useEffect(() => {
    loadMenus();
    loadIngredients();
  }, []);

  const isCocktailForm = useMemo(() => isCocktailCategory(formData.category), [formData.category]);

  const getIngredientById = (ingredientId) => {
    return ingredients.find((ingredient) => ingredient.id === Number(ingredientId)) || null;
  };

  const isCocktailIngredient = (ingredient) => {
    if (!ingredient) {
      return false;
    }

    return Boolean(ingredient.is_cocktail_ingredient)
      && normalizeText(ingredient.portion_unit) === 'ml'
      && isVolumeUnit(ingredient?.raw_material?.unit);
  };

  const getRequiredPortionsForSelection = (selectionItem) => {
    if (!isCocktailForm) {
      return Number(selectionItem?.quantity_needed || 0);
    }

    const ingredient = getIngredientById(selectionItem?.ingredient_id);
    const portionSize = Number(ingredient?.portion_size || 0);
    const quantityMl = Number(selectionItem?.quantity_ml || 0);

    if (!Number.isFinite(portionSize) || portionSize <= 0) {
      return 0;
    }

    return quantityMl / portionSize;
  };

  const loadMenus = async () => {
    try {
      const response = await adminAPI.getMenus();
      setMenus(response.data);
    } catch (error) {
      setMessage('Erreur lors du chargement des menus');
    } finally {
      setLoading(false);
    }
  };

  const loadIngredients = async () => {
    try {
      const response = await adminAPI.getIngredients();
      setIngredients(response.data);
    } catch (error) {
      console.error('Erreur chargement ingrédients:', error);
    }
  };

  const clearImagePreview = () => {
    setImagePreviewUrl((previousPreview) => {
      if (previousPreview && previousPreview.startsWith('blob:')) {
        URL.revokeObjectURL(previousPreview);
      }
      return '';
    });
  };

  const buildMenuFormData = (ingredientsPayload = selectedIngredients) => {
    const payload = new FormData();
    payload.append('name', String(formData.name || '').trim());
    payload.append('description', String(formData.description || '').trim());
    payload.append('price', String(formData.price ?? 0));
    payload.append('category', String(formData.category || 'main'));
    payload.append('is_available', formData.is_available ? '1' : '0');

    if (selectedImageFile) {
      payload.append('image_file', selectedImageFile);
    } else if (String(formData.image_url || '').trim()) {
      payload.append('image_url', String(formData.image_url || '').trim());
    }

    ingredientsPayload.forEach((ingredient, index) => {
      payload.append(`ingredients[${index}][ingredient_id]`, String(Number(ingredient.ingredient_id)));
      payload.append(`ingredients[${index}][quantity_needed]`, String(Number(ingredient.quantity_needed)));
    });

    return payload;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const normalizedIngredients = selectedIngredients.map((item) => {
        if (!isCocktailForm) {
          return {
            ...item,
            quantity_needed: Number(item.quantity_needed || 0),
          };
        }

        const ingredient = getIngredientById(item.ingredient_id);
        const portionSize = Number(ingredient?.portion_size || 0);
        const quantityMl = Number(item.quantity_ml || 0);
        const requiredPortions = portionSize > 0 ? (quantityMl / portionSize) : 0;

        return {
          ...item,
          quantity_ml: quantityMl,
          quantity_needed: requiredPortions,
        };
      });

      if (isCocktailForm) {
        if (normalizedIngredients.length === 0) {
          setMessage('Erreur: ajoute au moins un ingrédient cocktail pour ce menu.');
          return;
        }

        const invalidCocktailIngredient = normalizedIngredients.find((item) => {
          const ingredient = getIngredientById(item.ingredient_id);
          const isMl = normalizeText(ingredient?.portion_unit) === 'ml';
          return !ingredient || !isCocktailIngredient(ingredient) || !isMl;
        });

        if (invalidCocktailIngredient) {
          setMessage('Erreur: un cocktail doit utiliser uniquement des ingrédients marqués cocktail en ml.');
          return;
        }

        const invalidMlQuantity = normalizedIngredients.find((item) => {
          const requiredPortions = Number(item.quantity_needed || 0);
          const quantityMl = Number(item.quantity_ml || 0);

          if (!Number.isFinite(quantityMl) || quantityMl <= 0) {
            return true;
          }

          return !Number.isFinite(requiredPortions)
            || requiredPortions <= 0
            || Math.abs(requiredPortions - Math.round(requiredPortions)) > 0.0001;
        });

        if (invalidMlQuantity) {
          const ingredient = getIngredientById(invalidMlQuantity.ingredient_id);
          const portionSize = Number(ingredient?.portion_size || 0);
          setMessage(`Erreur: la quantité ml doit être un multiple de ${portionSize || 1} ml pour ${ingredient?.name || 'cet ingrédient'}.`);
          return;
        }
      }

      const unavailableIngredient = normalizedIngredients.find((item) => {
        const ingredient = getIngredientById(item.ingredient_id);
        return !ingredient || Number(ingredient.quantity_available || 0) <= 0;
      });

      if (unavailableIngredient) {
        setMessage('Erreur: un ingrédient sélectionné n\'est plus disponible en stock.');
        return;
      }

      const insufficientIngredient = normalizedIngredients.find((item) => {
        const ingredient = getIngredientById(item.ingredient_id);
        if (!ingredient) {
          return false;
        }

        const needed = Number(item.quantity_needed || 0);
        const available = Number(ingredient.quantity_available || 0);
        return needed > available;
      });

      if (insufficientIngredient) {
        const ingredientName = getIngredientName(insufficientIngredient.ingredient_id) || 'Ingrédient';
        setMessage(`Erreur: quantité demandée trop élevée pour ${ingredientName}.`);
        return;
      }

      const payloadIngredients = normalizedIngredients.map((item) => ({
        ingredient_id: item.ingredient_id,
        quantity_needed: Math.max(1, Math.round(Number(item.quantity_needed || 0))),
      }));

      const menuData = buildMenuFormData(payloadIngredients);

      if (editingMenu) {
        await adminAPI.updateMenu(editingMenu.id, menuData);
        setMessage('Menu modifié avec succès');
      } else {
        await adminAPI.createMenu(menuData);
        setMessage('Menu créé avec succès');
      }
      loadMenus();
      setShowModal(false);
      resetForm();
    } catch (error) {
      setMessage('Erreur lors de la sauvegarde');
    }
  };

  const handleEdit = (menu) => {
    loadIngredients();
    clearImagePreview();
    setEditingMenu(menu);
    setFormData({
      name: menu.name,
      description: menu.description,
      price: menu.price,
      category: menu.category === 'starter' ? 'entree' : menu.category,
      image_url: menu.image_url || '',
      is_available: menu.is_available ?? true,
      ingredients: menu.ingredients || [],
    });
    setSelectedImageFile(null);
    setImagePreviewUrl(String(menu.image_url || '').trim());
    const normalizedCategory = menu.category === 'starter' ? 'entree' : menu.category;
    const cocktail = isCocktailCategory(normalizedCategory);

    setSelectedIngredients(menu.ingredients ? menu.ingredients.map((mi) => {
      const quantityNeeded = Number(mi?.pivot?.quantity_needed ?? 1);
      const quantityMl = cocktail
        ? Math.round(quantityNeeded * Number(mi?.portion_size || 0))
        : null;

      return createIngredientSelection({
        ingredient_id: mi.id,
        quantity_needed: quantityNeeded,
        quantity_ml: quantityMl,
        name: mi.name,
      });
    }) : []);
    setOpenIngredientDropdownId(null);
    setIngredientSearchByRow({});
    setShowModal(true);
  };

  const handleDelete = async (menuId) => {
    const isConfirmed = await confirm({
      title: 'Supprimer menu',
      message: 'Êtes-vous sûr de vouloir supprimer ce menu ?',
      confirmText: 'Supprimer',
      cancelText: 'Annuler',
      tone: 'danger',
    });

    if (!isConfirmed) {
      return;
    }

    try {
      await adminAPI.deleteMenu(menuId);
      setMessage('Menu supprimé avec succès');
      loadMenus();
    } catch (error) {
      setMessage('Erreur lors de la suppression');
    }
  };

  const resetForm = () => {
    clearImagePreview();
    setFormData({
      name: '',
      description: '',
      price: 0,
      category: 'main',
      image_url: '',
      is_available: true,
      ingredients: [],
    });
    setSelectedImageFile(null);
    setSelectedIngredients([]);
    setOpenIngredientDropdownId(null);
    setIngredientSearchByRow({});
    setEditingMenu(null);
  };

  const openCreateModal = () => {
    loadIngredients();
    resetForm();
    setShowModal(true);
  };

  const addIngredient = () => {
    const newSelection = createIngredientSelection({
      quantity_needed: 1,
      quantity_ml: isCocktailForm ? 30 : null,
    });

    setSelectedIngredients((previous) => [...previous, newSelection]);
    setOpenIngredientDropdownId(newSelection.row_id);
    setIngredientSearchByRow((previous) => ({
      ...previous,
      [newSelection.row_id]: '',
    }));
  };

  const updateIngredient = (index, field, value) => {
    const updated = [...selectedIngredients];
    updated[index][field] = value;

    if (field === 'ingredient_id') {
      const selectedIngredient = getIngredientById(value);
      updated[index].name = selectedIngredient?.name || '';

      if (isCocktailForm) {
        const defaultMl = Math.max(1, Math.round(Number(selectedIngredient?.portion_size || 0)));
        updated[index].quantity_ml = defaultMl;
        updated[index].quantity_needed = 1;
      }
    }

    if (field === 'quantity_ml' && isCocktailForm) {
      const selectedIngredient = getIngredientById(updated[index].ingredient_id);
      const portionSize = Number(selectedIngredient?.portion_size || 0);
      const quantityMl = Number(value || 0);

      if (portionSize > 0 && Number.isFinite(quantityMl)) {
        updated[index].quantity_needed = quantityMl / portionSize;
      }
    }

    setSelectedIngredients(updated);
  };

  const removeIngredient = (index) => {
    const rowId = selectedIngredients[index]?.row_id;

    setSelectedIngredients(selectedIngredients.filter((_, i) => i !== index));
    if (rowId) {
      setIngredientSearchByRow((previous) => {
        const next = { ...previous };
        delete next[rowId];
        return next;
      });
      if (openIngredientDropdownId === rowId) {
        setOpenIngredientDropdownId(null);
      }
    }
  };

  const getIngredientName = (ingredientId) => {
    const ingredient = getIngredientById(ingredientId);
    return ingredient ? ingredient.name : '';
  };

  const availableIngredients = useMemo(() => {
    return ingredients
      .filter((ingredient) => Number(ingredient.quantity_available || 0) > 0)
      .filter((ingredient) => (isCocktailForm ? isCocktailIngredient(ingredient) : true));
  }, [ingredients, isCocktailForm]);

  useEffect(() => {
    if (!isCocktailForm) {
      return;
    }

    setSelectedIngredients((previous) => {
      return previous
        .filter((item) => {
          const ingredient = ingredients.find((candidate) => candidate.id === Number(item.ingredient_id));
          return ingredient && isCocktailIngredient(ingredient);
        })
        .map((item) => {
          const ingredient = ingredients.find((candidate) => candidate.id === Number(item.ingredient_id));
          const quantityMl = Number(item.quantity_ml || 0) > 0
            ? Number(item.quantity_ml)
            : Math.max(1, Math.round(Number(ingredient?.portion_size || 0)));

          return {
            ...item,
            quantity_ml: quantityMl,
          };
        });
    });
  }, [isCocktailForm, ingredients]);

  const getIngredientOptionsForRow = (selectedIngredientId, rowSearch = '') => {
    const keyword = normalizeText(rowSearch);
    const baseOptions = availableIngredients
      .filter((ingredient) => {
        if (!keyword) {
          return true;
        }

        const haystack = normalizeText([
          ingredient?.name,
          ingredient?.portion_unit,
          ingredient?.raw_material?.name,
        ].filter(Boolean).join(' '));

        return haystack.includes(keyword);
      })
      .sort((left, right) => String(left.name || '').localeCompare(String(right.name || '')));

    const selectedId = Number(selectedIngredientId);
    const selectedIngredient = ingredients.find((ingredient) => ingredient.id === selectedId);

    if (!selectedIngredient) {
      return baseOptions;
    }

    if (baseOptions.some((ingredient) => ingredient.id === selectedId)) {
      return baseOptions;
    }

    return [selectedIngredient, ...baseOptions];
  };

  const toggleIngredientDropdown = (rowId) => {
    setOpenIngredientDropdownId((previous) => (previous === rowId ? null : rowId));
    setIngredientSearchByRow((previous) => ({
      ...previous,
      [rowId]: previous[rowId] || '',
    }));
  };

  const updateIngredientSearchForRow = (rowId, value) => {
    setIngredientSearchByRow((previous) => ({
      ...previous,
      [rowId]: value,
    }));
  };

  const selectIngredientFromDropdown = (index, rowId, ingredientId) => {
    updateIngredient(index, 'ingredient_id', String(ingredientId));
    setOpenIngredientDropdownId(null);
    setIngredientSearchByRow((previous) => ({
      ...previous,
      [rowId]: '',
    }));
  };

  const getCategoryLabel = (category) => {
    const labels = {
      starter: 'Entrée',
      entree: 'Entrée',
      main: 'Plat principal',
      snack: 'Snack',
      dessert: 'Dessert',
      drink: 'Boisson',
      cocktail: 'Cocktail',
      side: 'Accompagnement',
    };
    return labels[category] || category;
  };

  const calculateTotalCost = () => {
    return selectedIngredients.reduce((total, si) => {
      const ingredient = getIngredientById(si.ingredient_id);
      if (ingredient) {
        const requiredPortions = getRequiredPortionsForSelection(si);
        return total + (Number(ingredient.cost_per_portion || 0) * Number(requiredPortions || 0));
      }
      return total;
    }, 0);
  };

  const calculateMargin = () => {
    const cost = parseFloat(calculateTotalCost());
    const price = parseFloat(formData.price);
    if (cost > 0 && price > 0) {
      return (((price - cost) / cost) * 100).toFixed(1);
    }
    return '0.0';
  };

  const getMenuIngredientItems = (menu) => {
    if (!Array.isArray(menu?.ingredients)) {
      return [];
    }

    const cocktail = isCocktailCategory(menu?.category);

    return menu.ingredients.map((ingredient) => ({
      id: ingredient.id,
      name: ingredient.name,
      quantityNeeded: Number(ingredient?.pivot?.quantity_needed || 0),
      quantityLabel: cocktail
        ? `${Math.round(Number(ingredient?.pivot?.quantity_needed || 0) * Number(ingredient?.portion_size || 0))} ml`
        : `${Number(ingredient?.pivot?.quantity_needed || 0)}x`,
    }));
  };

  const handleLocalImageChange = (event) => {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    if (!String(file.type || '').startsWith('image/')) {
      setMessage('Erreur: sélectionne un fichier image valide (jpg, png, webp...).');
      return;
    }

    clearImagePreview();
    const localPreview = URL.createObjectURL(file);
    setSelectedImageFile(file);
    setImagePreviewUrl(localPreview);
  };

  const removeSelectedImage = () => {
    clearImagePreview();
    setSelectedImageFile(null);
    setFormData((previous) => ({
      ...previous,
      image_url: '',
    }));
  };

  useEffect(() => {
    return () => {
      if (imagePreviewUrl && imagePreviewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(imagePreviewUrl);
      }
    };
  }, [imagePreviewUrl]);

  const currentPreviewImage = resolveApiAssetUrl(
    String(imagePreviewUrl || '').trim() || String(formData.image_url || '').trim()
  ) || getSuggestedMenuImageUrl(formData, '640x420');

  const menuColumns = [
    {
      key: 'name',
      header: 'Nom',
      sortAccessor: (menu) => menu.name,
      searchAccessor: (menu) => `${menu.name} ${menu.description || ''}`,
      render: (menu) => {
        const menuIngredientItems = getMenuIngredientItems(menu);
        return (
          <div>
            <strong>{menu.name}</strong>
            {menu.description && (
              <div style={{ fontSize: '0.8em', color: '#666', marginTop: '2px' }}>
                {menu.description}
              </div>
            )}
            {menuIngredientItems.length > 0 && (
              <div className="menu-ingredients-inline">
                {menuIngredientItems.map((ingredientItem) => (
                  <span key={`${menu.id}-${ingredientItem.id}`} className="menu-ingredient-chip">
                    {ingredientItem.quantityLabel} {ingredientItem.name}
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      },
    },
    {
      key: 'category',
      header: 'Catégorie',
      sortAccessor: (menu) => getCategoryLabel(menu.category),
      searchAccessor: (menu) => getCategoryLabel(menu.category),
      render: (menu) => getCategoryLabel(menu.category),
    },
    {
      key: 'price',
      header: 'Prix',
      sortType: 'number',
      sortAccessor: (menu) => Number(menu.price || 0),
      searchAccessor: (menu) => String(menu.price || ''),
      render: (menu) => formatAr(menu.price),
    },
    {
      key: 'is_available',
      header: 'Disponible',
      sortAccessor: (menu) => (menu.is_available ? 1 : 0),
      searchAccessor: (menu) => (menu.is_available ? 'disponible' : 'indisponible'),
      render: (menu) => (
        <span className={`status-badge ${menu.is_available ? 'status-available' : 'status-maintenance'}`}>
          {menu.is_available ? '✅ Disponible' : '❌ Indisponible'}
        </span>
      ),
    },
    {
      key: 'ingredients_count',
      header: 'Ingrédients',
      sortType: 'number',
      sortAccessor: (menu) => (Array.isArray(menu.ingredients) ? menu.ingredients.length : 0),
      searchAccessor: (menu) => String(Array.isArray(menu.ingredients) ? menu.ingredients.length : 0),
      render: (menu) => (menu.ingredients ? menu.ingredients.length : 0),
    },
    {
      key: 'actions',
      header: 'Actions',
      sortable: false,
      searchable: false,
      render: (menu) => (
        <div className="actions">
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => handleEdit(menu)}
          >
            ✏️
          </button>
          <button
            className="btn btn-danger btn-sm"
            onClick={() => handleDelete(menu.id)}
          >
            🗑️
          </button>
        </div>
      ),
    },
  ];

  if (loading) {
    return <div className="loading">Chargement des menus...</div>;
  }

  return (
    <div>
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h2>🍽️ Gestion des Menus</h2>
          <button className="btn btn-primary" onClick={openCreateModal}>
            ➕ Ajouter Menu
          </button>
        </div>

        {message && (
          <div className={`message ${message.includes('Erreur') ? 'error-message' : 'success-message'}`}>
            {message}
          </div>
        )}

        <DataTable
          columns={menuColumns}
          data={menus}
          rowKey="id"
          searchPlaceholder="Rechercher un menu (nom, catégorie, disponibilité)..."
          initialSort={{ key: 'name', direction: 'asc' }}
          emptyMessage="Aucun menu trouvé."
        />
      </div>

      {/* Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editingMenu ? 'Modifier Menu' : 'Créer Menu'}</h3>
              <button className="modal-close" onClick={() => setShowModal(false)}>×</button>
            </div>

            <form onSubmit={handleSubmit}>
              <div className="form-row">
                <div className="form-group">
                  <label>Nom du menu</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({...formData, name: e.target.value})}
                    required
                    placeholder="Ex: Burger Classique, Salade César..."
                  />
                </div>

                <div className="form-group">
                  <label>Catégorie</label>
                  <select
                    value={formData.category}
                    onChange={(e) => setFormData({...formData, category: e.target.value})}
                    required
                  >
                    <option value="entree">🥗 Entrée</option>
                    <option value="main">🍖 Plat principal</option>
                    <option value="snack">🍔 Snack</option>
                    <option value="dessert">🍰 Dessert</option>
                    <option value="drink">🥤 Boisson</option>
                    <option value="cocktail">🍸 Cocktail</option>
                    <option value="side">🍟 Accompagnement</option>
                  </select>
                </div>
              </div>

              <div className="form-group">
                <label>Description</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({...formData, description: e.target.value})}
                  placeholder="Description du plat..."
                  rows="3"
                />
              </div>

              <div className="form-group">
                <label>Image du plat (fichier local)</label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleLocalImageChange}
                />
                <div className="image-helper-row">
                  <button type="button" className="btn btn-secondary btn-sm" onClick={removeSelectedImage}>
                    🧹 Retirer l'image
                  </button>
                  <span className="form-hint">
                    {selectedImageFile
                      ? `Fichier sélectionné: ${selectedImageFile.name}`
                      : 'Sélectionne un fichier image depuis ton ordinateur (stockage local).'}
                  </span>
                </div>
                <div className="menu-image-preview-wrap">
                  <img
                    src={currentPreviewImage}
                    alt={formData.name || 'Aperçu menu'}
                    className="menu-image-preview"
                  />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Prix de vente (Ar)</label>
                  <input
                    type="number"
                    value={formData.price}
                    onChange={(e) => setFormData({...formData, price: parseFloat(e.target.value)})}
                    required
                    min="0"
                    step="0.01"
                  />
                </div>

                <div className="form-group">
                  <label>Disponibilité</label>
                  <select
                    value={formData.is_available}
                    onChange={(e) => setFormData({...formData, is_available: e.target.value === 'true'})}
                  >
                    <option value={true}>✅ Disponible</option>
                    <option value={false}>❌ Indisponible</option>
                  </select>
                </div>
              </div>

              <div className="form-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                  <label>Ingrédients requis</label>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={addIngredient} disabled={availableIngredients.length === 0}>
                    ➕ Ajouter Ingrédient
                  </button>
                </div>

                {isCocktailForm && (
                  <div className="form-hint" style={{ marginBottom: '8px' }}>
                    Mode cocktail: seuls les ingrédients buvables/liquides marqués cocktail (portion en ml) sont proposés.
                  </div>
                )}

                {availableIngredients.length === 0 && (
                  <div className="form-hint">
                    {isCocktailForm
                      ? 'Aucun ingrédient cocktail disponible actuellement.'
                      : 'Aucun ingrédient disponible actuellement (stock épuisé).'}
                  </div>
                )}

                {selectedIngredients.map((si, index) => {
                  const selectedIngredient = getIngredientById(si.ingredient_id);
                  const portionSize = Number(selectedIngredient?.portion_size || 0);
                  const rowId = si.row_id || `ingredient-row-fallback-${index}`;
                  const rowSearch = ingredientSearchByRow[rowId] || '';
                  const ingredientOptions = getIngredientOptionsForRow(si.ingredient_id, rowSearch);
                  const dropdownOpen = openIngredientDropdownId === rowId;
                  const triggerLabel = selectedIngredient
                    ? `${selectedIngredient.name} (${selectedIngredient.portion_size} ${selectedIngredient.portion_unit}) · Dispo: ${Number(selectedIngredient.quantity_available || 0)} · ${formatAr(selectedIngredient.cost_per_portion)} / portion`
                    : 'Sélectionner un ingrédient';

                  return (
                    <div key={rowId} className="ingredient-row">
                      <div className="ingredient-select-wrap">
                        <button
                          type="button"
                          className={`ingredient-select-trigger ${selectedIngredient ? 'has-value' : ''}`}
                          onClick={() => toggleIngredientDropdown(rowId)}
                        >
                          {triggerLabel}
                        </button>

                        {dropdownOpen && (
                          <div className="ingredient-select-dropdown">
                            <input
                              type="text"
                              className="ingredient-select-search"
                              value={rowSearch}
                              onChange={(event) => updateIngredientSearchForRow(rowId, event.target.value)}
                              placeholder="Rechercher dans la liste..."
                              autoFocus
                            />

                            <div className="ingredient-select-options">
                              {ingredientOptions.length === 0 ? (
                                <div className="ingredient-select-empty">Aucun ingrédient trouvé.</div>
                              ) : (
                                ingredientOptions.map((ingredient) => (
                                  <button
                                    key={ingredient.id}
                                    type="button"
                                    className={`ingredient-select-option ${Number(si.ingredient_id) === Number(ingredient.id) ? 'is-selected' : ''}`}
                                    onClick={() => selectIngredientFromDropdown(index, rowId, ingredient.id)}
                                  >
                                    <span>{ingredient.name} ({ingredient.portion_size} {ingredient.portion_unit})</span>
                                    <small>Dispo: {Number(ingredient.quantity_available || 0)} · {formatAr(ingredient.cost_per_portion)} / portion</small>
                                  </button>
                                ))
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                      <div className="ingredient-quantity-wrap">
                        <input
                          type="number"
                          placeholder={isCocktailForm ? 'Quantité ml' : 'Nb portions'}
                          value={isCocktailForm ? (si.quantity_ml ?? '') : si.quantity_needed}
                          onChange={(e) => updateIngredient(
                            index,
                            isCocktailForm ? 'quantity_ml' : 'quantity_needed',
                            parseInt(e.target.value || '0', 10)
                          )}
                          min="1"
                          step="1"
                          required
                        />
                        {isCocktailForm && portionSize > 0 ? (
                          <small className="form-hint">
                            1 portion = {portionSize} ml
                          </small>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        className="btn btn-danger btn-sm"
                        onClick={() => removeIngredient(index)}
                      >
                        🗑️
                      </button>
                    </div>
                  );
                })}
              </div>

              {selectedIngredients.length > 0 && (
                <div className="cost-summary">
                  <div>Coût total des ingrédients: <strong>{formatAr(calculateTotalCost())}</strong></div>
                  <div>Marge bénéficiaire: <strong>{calculateMargin()} %</strong></div>
                </div>
              )}

              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>
                  Annuler
                </button>
                <button type="submit" className="btn btn-primary">
                  {editingMenu ? 'Modifier' : 'Créer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default MenuManagement;
