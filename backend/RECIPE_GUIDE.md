# 👨‍🍳 Guide du Système de Recettes

## Vue d'ensemble

Le système de recettes vous permet de:
1. **Lier les plats aux produits de base** - Ex: "Poulet au Curry" est lié à "Poulet"
2. **Lister les ingrédients nécessaires** - Tous les ingrédients requis pour préparer un plat
3. **Documenter les étapes de préparation** - Comment préparer chaque plat pas à pas
4. **Afficher le coût total des matières** - Basé sur les ingrédients
5. **Suivre le temps de préparation** - Durée totale et par étape

---

## 🎯 Cas d'usage: Poulet au Curry

### 1️⃣ Créer la structure de base

#### Étape 1: Créer le produit parent "Poulet"
- **Aller à**: Créer un produit
- **Configuration**:
  - Catégorie: Poulet
  - Désignation: `Poulet`
  - Description: `Poulet frais pour cuisiner`
  - Prix: Prix moyen (serve de référence)
  - Stock: Quantité disponible
  - **Produit Parent**: Laisser vide (c'est la base!)

#### Étape 2: Créer la recette "Poulet au Curry"
- **Aller à**: Créer un produit
- **Configuration**:
  - Catégorie: Poulet (ou Plats)
  - Désignation: `Poulet au Curry`
  - Description: `Poulet en sauce curry avec légumes`
  - Prix: 12.50€ (prix de vente)
  - Stock: 0 (les plats sont préparés)
  - **Produit Parent**: ✅ **Sélectionnez "Poulet"**

### 2️⃣ Ajouter les ingrédients

1. **Aller à** l'édition du produit "Poulet au Curry"
2. **Section Ingrédients** (Voir ProductEdit pour cette partie)
3. **Ajouter les ingrédients**:
   - 200g de Poulet (coût: 1.10€)
   - 100ml de Sauce Curry (coût: 0.80€)
   - 50g d'Oignons (coût: 0.15€)
   - 50g de Poivrons (coût: 0.20€)
   - 150ml de Crème (coût: 0.60€)

**Total des matières**: 2.85€

### 3️⃣ Documenter la recette

1. **Aller à** Éditer la recette: Cliquez "✏️ Éditer Recette"
2. **Ajouter les étapes de préparation**:

**Étape 1 - Préparer les ingrédients**
- ⏱️ Durée: 5 minutes
- 🌡️ Température: Température ambiante
- Instruction: Découper le poulet en cubes, émincer les oignons, couper les poivrons

**Étape 2 - Cuire le poulet**
- ⏱️ Durée: 8 minutes
- 🌡️ Température: 200°C
- Instruction: Faire dorer le poulet à la poêle avec un peu d'huile

**Étape 3 - Ajouter la sauce**
- ⏱️ Durée: 10 minutes
- 🌡️ Température: Feu moyen
- Instruction: Ajouter les oignons, poivrons, puis verser la sauce curry et la crème

**Étape 4 - Laisser mijoter**
- ⏱️ Durée: 12 minutes
- 🌡️ Température: Feu doux
- Instruction: Laisser mijoter jusqu'à ce que la sauce épaississe et les légumes soient tendres

**Total**: ~35 minutes

### 4️⃣ Consulter la recette

1. **Aller à** la page de détail du produit
2. **Cliquez** "👨‍🍳 Voir Recette"
3. **Vous verrez**:
   - ✅ Lien au produit parent (Poulet)
   - 🥘 Tous les ingrédients avec quantités et coûts
   - 👨‍🍳 Les étapes numérotées avec durée et température
   - 📚 Autres recettes avec Poulet (si existent)

---

## 📊 Structure des données

### Relations:

```
Product (Poulet)
├── recipes: [Poulet au Curry, Poulet aux Légumes, ...]
└── preparationSteps: []  (vide pour produit de base)

Product (Poulet au Curry)
├── parentProduct: Poulet
├── ingredients: [Poulet, Sauce Curry, Oignons, ...]
├── preparationSteps: [Étape 1, Étape 2, Étape 3, Étape 4]
└── recipes: []  (vide car dérivé)
```

### Tables:

**products** (existante + nouvelle colonne):
```sql
id, category_id, parent_product_id, designation, description, price, stock, created_at, updated_at
```

**preparation_steps** (nouvelle):
```sql
id, product_id, step_order, instruction, duration_minutes, temperature, created_at, updated_at
```

---

## 🛠️ API Endpoints

### Produits avec recettes:
```
GET    /api/products           → Tous les produits + relations
GET    /api/products/{id}      → Produit + parent + ingrédients + étapes
POST   /api/products           → Créer produit (+ parent_product_id)
PUT    /api/products/{id}      → Modifier produit
```

### Étapes de préparation:
```
POST   /api/preparation-steps           → Créer une étape
GET    /api/preparation-steps/{id}      → Récupérer une étape
PUT    /api/preparation-steps/{id}      → Modifier une étape
DELETE /api/preparation-steps/{id}      → Supprimer une étape
POST   /api/products/{id}/preparation-steps/reorder → Réordonner
```

---

## 🎮 Routes Frontend

```
/products/{id}/recipe          → Afficher la recette complète
/products/{id}/recipe/edit     → Éditer les étapes de préparation
/products/{id}/edit            → Modifier le produit + parent
/products                       → Liste tous les produits
```

---

## 💡 Cas d'usage avancés

### Créer une hiérarchie de plats:

```
Poulet (produit de base)
├── Poulet au Curry
├── Poulet aux Légumes
├── Poulet à l'Ail
└── Poulet aux Champignons

Porc (produit de base)
├── Porc Aigre-Doux
├── Porc aux Oignons
└── Porc en Sauce Soja

Riz (produit de base)
├── Riz Frit Poulet
├── Riz Frit Porc
└── Riz Frit Crevettes
```

### Chaque recette inclut:
- ✅ Les ingrédients spécifiques et leurs coûts
- ✅ Les étapes détaillées avec timing
- ✅ Le lien au produit parent pour trace
- ✅ Accès rapide à tous les plats basés sur le même produit

---

## 📝 Notes importantes

1. **Produits de base** n'ont PAS de `parent_product_id`
2. **Recettes/Plats dérivés** DOIVENT avoir un `parent_product_id`
3. **Les ingrédients** sont liés via la table `product_ingredients`
4. **Les étapes** sont numérotées et ordonnées automatiquement
5. **Les durées** s'additionnent pour le temps total de préparation

---

## 🚀 Prochaines étapes

- [ ] Créer des seeder pour lier recettes existantes
- [ ] Ajouter photos des recettes
- [ ] Ajouter des notes culinaires par étape
- [ ] Générer des plans de production
- [ ] Exporter les recettes en PDF

