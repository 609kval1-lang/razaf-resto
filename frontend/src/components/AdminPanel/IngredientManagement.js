import React, { useEffect, useMemo, useState } from 'react';
import { adminAPI } from '../../services/api';
import { useDialog } from '../common/DialogProvider';
import DataTable from '../common/DataTable';
import {
  convertUnitValue,
  getLinkedPortionUnit,
  getUnitMeta,
  INGREDIENT_PORTION_UNIT_OPTIONS,
  isVolumeUnit,
  normalizeUnit,
} from '../../utils/units';

const formatAr = (value) => {
  const amount = Number(value || 0);
  return `${amount.toLocaleString('fr-FR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })} Ar`;
};

const formatQty = (value) => {
  const qty = Number(value || 0);
  if (Number.isInteger(qty)) {
    return qty.toString();
  }

  return qty.toLocaleString('fr-FR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  });
};

const IngredientManagement = () => {
  const { confirm } = useDialog();
  const [ingredients, setIngredients] = useState([]);
  const [rawMaterials, setRawMaterials] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingIngredient, setEditingIngredient] = useState(null);
  const [formData, setFormData] = useState({
    raw_material_id: '',
    name: '',
    portion_size: 100,
    portion_unit: 'g',
    quantity_available: 0,
    cost_per_portion: 0,
    is_cocktail_ingredient: false,
  });
  const [rawMaterialSearch, setRawMaterialSearch] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    loadIngredients();
    loadRawMaterials();
  }, []);

  const loadIngredients = async () => {
    try {
      const response = await adminAPI.getIngredients();
      setIngredients(Array.isArray(response.data) ? response.data : []);
    } catch (_error) {
      setMessage('Erreur lors du chargement des ingrédients');
    } finally {
      setLoading(false);
    }
  };

  const loadRawMaterials = async () => {
    try {
      const response = await adminAPI.getRawMaterials();
      setRawMaterials(Array.isArray(response.data) ? response.data : []);
    } catch (_error) {
      setMessage('Erreur lors du chargement des matières premières');
    }
  };

  const selectedRawMaterial = useMemo(() => {
    return rawMaterials.find((material) => material.id === Number(formData.raw_material_id)) || null;
  }, [formData.raw_material_id, rawMaterials]);

  const isSelectedRawMaterialLiquid = useMemo(() => {
    return isVolumeUnit(selectedRawMaterial?.unit);
  }, [selectedRawMaterial?.unit]);

  const linkedPortionUnit = useMemo(() => {
    return getLinkedPortionUnit(selectedRawMaterial?.unit);
  }, [selectedRawMaterial?.unit]);

  const canBeCocktailIngredient = useMemo(() => {
    return isSelectedRawMaterialLiquid && normalizeUnit(formData.portion_unit) === 'ml';
  }, [formData.portion_unit, isSelectedRawMaterialLiquid]);

  useEffect(() => {
    if (!linkedPortionUnit) return;

    setFormData((previous) => {
      if (normalizeUnit(previous.portion_unit) === normalizeUnit(linkedPortionUnit)) {
        return previous;
      }

      return {
        ...previous,
        portion_unit: linkedPortionUnit,
        is_cocktail_ingredient: isSelectedRawMaterialLiquid ? previous.is_cocktail_ingredient : false,
      };
    });
  }, [linkedPortionUnit, isSelectedRawMaterialLiquid]);

  useEffect(() => {
    if (!canBeCocktailIngredient && formData.is_cocktail_ingredient) {
      setFormData((previous) => ({
        ...previous,
        is_cocktail_ingredient: false,
      }));
    }
  }, [canBeCocktailIngredient, formData.is_cocktail_ingredient]);

  const portionUnitOptions = useMemo(() => {
    if (linkedPortionUnit) {
      const linkedOption = INGREDIENT_PORTION_UNIT_OPTIONS.find(
        (option) => normalizeUnit(option.value) === normalizeUnit(linkedPortionUnit),
      );

      if (linkedOption) {
        return [linkedOption];
      }

      return [{ value: linkedPortionUnit, label: linkedPortionUnit }];
    }

    const currentUnit = String(formData.portion_unit || '');
    const exists = INGREDIENT_PORTION_UNIT_OPTIONS.some((option) => option.value === currentUnit);
    if (!currentUnit || exists) {
      return INGREDIENT_PORTION_UNIT_OPTIONS;
    }

    return [{ value: currentUnit, label: `${currentUnit} (unité existante)` }, ...INGREDIENT_PORTION_UNIT_OPTIONS];
  }, [formData.portion_unit, linkedPortionUnit]);

  const calculatedPreview = useMemo(() => {
    const rawMaterial = selectedRawMaterial;

    if (!rawMaterial) {
      return {
        quantityAvailable: 0,
        costPerPortion: 0,
        error: '',
        explanation: 'Sélectionnez une matière première pour calculer automatiquement les portions.',
      };
    }

    const portionSize = Number(formData.portion_size || 0);
    if (portionSize <= 0) {
      return {
        quantityAvailable: 0,
        costPerPortion: 0,
        error: 'La taille de portion doit être supérieure à zéro.',
        explanation: '',
      };
    }

    try {
      const stockInPortionUnit = convertUnitValue(rawMaterial.stock, rawMaterial.unit, formData.portion_unit);
      const quantityAvailable = Math.floor(stockInPortionUnit / portionSize);

      const portionInRawUnit = convertUnitValue(portionSize, formData.portion_unit, rawMaterial.unit);
      const costPerPortion = Number(rawMaterial.cost || 0) * portionInRawUnit;

      return {
        quantityAvailable: Math.max(0, quantityAvailable),
        costPerPortion,
        error: '',
        explanation: `${formatQty(rawMaterial.stock)} ${rawMaterial.unit} ÷ ${formatQty(portionSize)} ${formData.portion_unit} = ${Math.max(0, quantityAvailable)} portions`,
      };
    } catch (error) {
      return {
        quantityAvailable: 0,
        costPerPortion: 0,
        error: error.message || 'Conversion impossible entre les unités',
        explanation: '',
      };
    }
  }, [formData.portion_size, formData.portion_unit, selectedRawMaterial]);

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (calculatedPreview.error) {
      setMessage(calculatedPreview.error);
      return;
    }

    try {
      const payload = {
        raw_material_id: Number(formData.raw_material_id),
        name: formData.name,
        portion_size: Number(formData.portion_size || 0),
        portion_unit: formData.portion_unit,
        quantity_available: Number(calculatedPreview.quantityAvailable || 0),
        cost_per_portion: Number(calculatedPreview.costPerPortion || 0),
        is_cocktail_ingredient: canBeCocktailIngredient && Boolean(formData.is_cocktail_ingredient),
      };

      if (editingIngredient) {
        await adminAPI.updateIngredient(editingIngredient.id, payload);
        setMessage('Ingrédient modifié avec succès');
      } else {
        await adminAPI.createIngredient(payload);
        setMessage('Ingrédient créé avec succès');
      }

      setShowModal(false);
      resetForm();
      await Promise.all([loadIngredients(), loadRawMaterials()]);
    } catch (error) {
      setMessage(error?.response?.data?.error || 'Erreur lors de la sauvegarde');
    }
  };

  const handleEdit = (ingredient) => {
    setEditingIngredient(ingredient);
    setFormData({
      raw_material_id: ingredient.raw_material_id || '',
      name: ingredient.name || '',
      portion_size: Number(ingredient.portion_size || 0),
      portion_unit: ingredient.portion_unit || 'g',
      quantity_available: Number(ingredient.quantity_available || 0),
      cost_per_portion: Number(ingredient.cost_per_portion || 0),
      is_cocktail_ingredient: Boolean(ingredient.is_cocktail_ingredient),
    });
    setRawMaterialSearch(String(ingredient?.raw_material?.name || ''));
    setShowModal(true);
  };

  const handleRawMaterialChange = (rawMaterialId) => {
    const material = rawMaterials.find((item) => item.id === Number(rawMaterialId));
    const dimension = getUnitMeta(material?.unit)?.dimension;
    const liquid = dimension === 'volume';
    const nextPortionUnit = getLinkedPortionUnit(material?.unit) || 'g';

    setFormData((previous) => ({
      ...previous,
      raw_material_id: rawMaterialId,
      portion_unit: nextPortionUnit,
      is_cocktail_ingredient: liquid ? true : false,
    }));
  };

  const handlePortionUnitChange = (portionUnit) => {
    if (linkedPortionUnit && normalizeUnit(portionUnit) !== normalizeUnit(linkedPortionUnit)) {
      return;
    }

    setFormData((previous) => {
      const liquid = isVolumeUnit(selectedRawMaterial?.unit);
      const isMl = normalizeUnit(portionUnit) === 'ml';

      return {
        ...previous,
        portion_unit: portionUnit,
        is_cocktail_ingredient: liquid && isMl ? previous.is_cocktail_ingredient : false,
      };
    });
  };

  const handleDelete = async (ingredientId) => {
    const isConfirmed = await confirm({
      title: 'Supprimer ingrédient',
      message: 'Êtes-vous sûr de vouloir supprimer cet ingrédient ?',
      confirmText: 'Supprimer',
      cancelText: 'Annuler',
      tone: 'danger',
    });

    if (!isConfirmed) {
      return;
    }

    try {
      await adminAPI.deleteIngredient(ingredientId);
      setMessage('Ingrédient supprimé avec succès');
      await loadIngredients();
    } catch (_error) {
      setMessage('Erreur lors de la suppression');
    }
  };

  const resetForm = () => {
    setFormData({
      raw_material_id: '',
      name: '',
      portion_size: 100,
      portion_unit: 'g',
      quantity_available: 0,
      cost_per_portion: 0,
      is_cocktail_ingredient: false,
    });
    setRawMaterialSearch('');
    setEditingIngredient(null);
  };

  const openCreateModal = () => {
    resetForm();
    setShowModal(true);
  };

  const getStockStatus = (available) => {
    const quantity = Number(available || 0);

    if (quantity <= 10) return 'low';
    if (quantity <= 30) return 'warning';
    return 'good';
  };

  const getStockStatusLabel = (status) => {
    const labels = {
      low: '🔴 Faible',
      warning: '🟡 Moyen',
      good: '🟢 Bon',
    };

    return labels[status] || 'OK';
  };

  const filteredRawMaterials = useMemo(() => {
    const keyword = String(rawMaterialSearch || '').trim().toLowerCase();

    if (!keyword) {
      return rawMaterials;
    }

    return rawMaterials.filter((material) => {
      const name = String(material?.name || '').toLowerCase();
      const unit = String(material?.unit || '').toLowerCase();
      return name.includes(keyword) || unit.includes(keyword);
    });
  }, [rawMaterialSearch, rawMaterials]);

  const rawMaterialOptions = useMemo(() => {
    const selectedId = Number(formData.raw_material_id);
    const selectedMaterial = rawMaterials.find((material) => material.id === selectedId);

    if (!selectedMaterial) {
      return filteredRawMaterials;
    }

    if (filteredRawMaterials.some((material) => material.id === selectedId)) {
      return filteredRawMaterials;
    }

    return [selectedMaterial, ...filteredRawMaterials];
  }, [filteredRawMaterials, formData.raw_material_id, rawMaterials]);

  const ingredientColumns = [
    {
      key: 'name',
      header: 'Nom',
      sortAccessor: (ingredient) => ingredient.name,
      searchAccessor: (ingredient) => ingredient.name,
      render: (ingredient) => ingredient.name,
    },
    {
      key: 'raw_material',
      header: 'Matière première',
      sortAccessor: (ingredient) => ingredient?.raw_material?.name || '',
      searchAccessor: (ingredient) => ingredient?.raw_material?.name || '',
      render: (ingredient) => ingredient?.raw_material?.name || '-',
    },
    {
      key: 'portion',
      header: 'Portion',
      sortAccessor: (ingredient) => `${ingredient.portion_size} ${ingredient.portion_unit}`,
      searchAccessor: (ingredient) => `${ingredient.portion_size} ${ingredient.portion_unit}`,
      render: (ingredient) => `${formatQty(ingredient.portion_size)} ${ingredient.portion_unit}`,
    },
    {
      key: 'raw_stock',
      header: 'Stock brut',
      sortType: 'number',
      sortAccessor: (ingredient) => Number(ingredient?.raw_material?.stock || 0),
      searchAccessor: (ingredient) => `${ingredient?.raw_material?.stock || ''} ${ingredient?.raw_material?.unit || ''}`,
      render: (ingredient) => (
        ingredient?.raw_material
          ? `${formatQty(ingredient.raw_material.stock)} ${ingredient.raw_material.unit}`
          : '-'
      ),
    },
    {
      key: 'quantity_available',
      header: 'Portions disponibles (auto)',
      sortType: 'number',
      sortAccessor: (ingredient) => Number(ingredient.quantity_available || 0),
      searchAccessor: (ingredient) => String(ingredient.quantity_available || ''),
      render: (ingredient) => Number(ingredient.quantity_available || 0),
    },
    {
      key: 'cost_per_portion',
      header: 'Coût / portion (auto)',
      sortType: 'number',
      sortAccessor: (ingredient) => Number(ingredient.cost_per_portion || 0),
      searchAccessor: (ingredient) => String(ingredient.cost_per_portion || ''),
      render: (ingredient) => formatAr(ingredient.cost_per_portion),
    },
    {
      key: 'is_cocktail_ingredient',
      header: 'Cocktail',
      sortAccessor: (ingredient) => (ingredient.is_cocktail_ingredient ? 1 : 0),
      searchAccessor: (ingredient) => (ingredient.is_cocktail_ingredient ? 'cocktail' : ''),
      render: (ingredient) => (ingredient.is_cocktail_ingredient ? '🍸 Oui' : '—'),
    },
    {
      key: 'stock_status',
      header: 'Statut',
      sortAccessor: (ingredient) => getStockStatusLabel(getStockStatus(ingredient.quantity_available)),
      searchAccessor: (ingredient) => getStockStatusLabel(getStockStatus(ingredient.quantity_available)),
      render: (ingredient) => {
        const stockStatus = getStockStatus(ingredient.quantity_available);
        return (
          <span className={`stock-status ${stockStatus}`}>
            {getStockStatusLabel(stockStatus)}
          </span>
        );
      },
    },
    {
      key: 'actions',
      header: 'Actions',
      sortable: false,
      searchable: false,
      render: (ingredient) => (
        <div className="actions">
          <button className="btn btn-secondary btn-sm" onClick={() => handleEdit(ingredient)}>
            ✏️
          </button>
          <button className="btn btn-danger btn-sm" onClick={() => handleDelete(ingredient.id)}>
            🗑️
          </button>
        </div>
      ),
    },
  ];

  if (loading) {
    return <div className="loading">Chargement des ingrédients...</div>;
  }

  return (
    <div>
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h2>🥕 Gestion des Ingrédients (Portions)</h2>
          <button className="btn btn-primary" onClick={openCreateModal}>
            ➕ Ajouter Ingrédient
          </button>
        </div>

        {message && (
          <div className={`message ${message.includes('Erreur') || message.includes('incompatible') ? 'error-message' : 'success-message'}`}>
            {message}
          </div>
        )}

        <DataTable
          columns={ingredientColumns}
          data={ingredients}
          rowKey="id"
          searchPlaceholder="Rechercher un ingrédient (nom, matière, portion, statut)..."
          initialSort={{ key: 'quantity_available', direction: 'asc' }}
          emptyMessage="Aucun ingrédient trouvé."
        />
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h3>{editingIngredient ? 'Modifier Ingrédient' : 'Créer Ingrédient'}</h3>
              <button className="modal-close" onClick={() => setShowModal(false)}>×</button>
            </div>

            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label>Nom de la portion d'ingrédient</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(event) => setFormData({ ...formData, name: event.target.value })}
                  placeholder="Ex: Riz 150g"
                  required
                />
              </div>

              <div className="form-group">
                <label>Matière première associée</label>
                <input
                  type="text"
                  value={rawMaterialSearch}
                  onChange={(event) => setRawMaterialSearch(event.target.value)}
                  placeholder="Rechercher une matière première..."
                />
                <div className="form-hint" style={{ marginBottom: '6px' }}>
                  {rawMaterialOptions.length} résultat(s)
                </div>
                <select
                  value={formData.raw_material_id}
                  onChange={(event) => handleRawMaterialChange(event.target.value)}
                  required
                >
                  <option value="">Sélectionner</option>
                  {rawMaterialOptions.map((material) => (
                    <option key={material.id} value={material.id}>
                      {material.name} ({formatQty(material.stock)} {material.unit})
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Taille de portion</label>
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={formData.portion_size}
                    onChange={(event) => setFormData({ ...formData, portion_size: event.target.value })}
                    required
                  />
                </div>

                <div className="form-group">
                  <label>Unité de portion</label>
                  <select
                    value={formData.portion_unit}
                    onChange={(event) => handlePortionUnitChange(event.target.value)}
                    disabled={Boolean(linkedPortionUnit)}
                    required
                  >
                    {portionUnitOptions.map((unitOption) => (
                      <option key={unitOption.value} value={unitOption.value}>
                        {unitOption.label}
                      </option>
                    ))}
                  </select>
                  {selectedRawMaterial ? (
                    <div className="form-hint">
                      Unité liée automatiquement: {selectedRawMaterial.unit} vers {linkedPortionUnit || formData.portion_unit}.
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="form-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input
                    type="checkbox"
                    checked={Boolean(formData.is_cocktail_ingredient)}
                    onChange={(event) => setFormData({ ...formData, is_cocktail_ingredient: event.target.checked })}
                    disabled={!canBeCocktailIngredient}
                  />
                  Ingrédient utilisable pour les cocktails (bar)
                </label>
                <div className="form-hint">
                  Disponible seulement pour les ingrédients buvables: matière première liquide et portion en ml.
                </div>
              </div>

              <div className={`cost-summary ${calculatedPreview.error ? 'is-error' : ''}`}>
                {calculatedPreview.error ? (
                  <div>Conversion impossible: {calculatedPreview.error}</div>
                ) : (
                  <>
                    <div>Portions disponibles calculées: <strong>{calculatedPreview.quantityAvailable}</strong></div>
                    <div>Coût par portion calculé: <strong>{formatAr(calculatedPreview.costPerPortion)}</strong></div>
                    <div className="form-hint">{calculatedPreview.explanation}</div>
                  </>
                )}
              </div>

              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>
                  Annuler
                </button>
                <button type="submit" className="btn btn-primary" disabled={Boolean(calculatedPreview.error)}>
                  {editingIngredient ? 'Modifier' : 'Créer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default IngredientManagement;
