# 🧪 Guide de Test des Limites de Stock

## ✅ Données de test configurées

Les 5 premier ingrédients sont configurés avec différents niveaux de stock:

| # | Ingrédient | Stock | Minimum | Statut | Couleur |
|---|---|---|---|---|---|
| 1 | Sauce soja | **0** | 10 | 🚨 CRITIQUE | 🔴 Rouge |
| 2 | Sauce huître | **2** | 8 | ⚠️ URGENT | 🟠 Orange |
| 3 | Sauce Sriracha | **5** | 5 | ⚡ ALERTE | 🟡 Jaune |
| 4 | Sauce haricot noir | **10** | 5 | ✓ OK | 🟢 Vert |
| 5 | Sauce aigre-douce | **30** | 6 | ✓ OK | 🟢 Vert |

---

## 🎯 Test 1: Voir les limites de stock

### Étape 1: Accédez à la page des limites
```
URL: http://localhost:3000/dashboard/stock/minimum-levels
```

### Étape 2: Observez les statuts

Vous devriez voir:
- ✅ **Sauce soja** en RED (CRITIQUE) - Stock = 0
- ✅ **Sauce huître** en ORANGE (URGENT) - Stock = 2 (< 50% du min)
- ✅ **Sauce Sriracha** en YELLOW (ALERTE) - Stock = 5 (= min)
- ✅ **Sauce haricot noir** en GREEN (OK) - Stock = 10
- ✅ **Sauce aigre-douce** en GREEN (OK) - Stock = 30

### Étape 3: Testez les filtres

**Cliquer sur les filtres** pour voir:
```
📊 Tous (5 items)
🚨 CRITIQUE (1 item)    ← Sauce soja
⚠️ URGENT (1 item)      ← Sauce huître
⚡ ALERTE (1 item)      ← Sauce Sriracha
✓ OK (2 items)          ← Sauce haricot noir, Sauce aigre-douce
```

### Étape 4: Testez l'édition inline

1. **Cliquez sur ✏️ pour la Sauce soja**
2. **Changez le minimum** de 10 à 5
3. **Cliquez ✅ Enregistrer**
4. **Le statut doit passer** de CRITIQUE à ALERTE (car stock = 0 < min = 5)

---

## 🎯 Test 2: Faire des ajustements de stock

### Étape 1: Allez à la page d'ajustement
```
URL: http://localhost:3000/dashboard/stock/adjustment
```

### Étape 2: Testez l'ajustement de la Sauce soja

1. **Sélectionnez le type**: 🥘 Ingrédients
2. **Recherchez**: "Sauce soja"
3. **Cliquez dessus** pour la sélectionner
4. **Entrez la quantité**: +50
5. **Raison**: 📦 Réapprovisionnement
6. **Cliquez**: ✅ Valider l'ajustement

### Résultat attendu:
```
✅ Stock ajusté de 50 L
Sauce soja: 0 → 50
```

---

## 🎯 Test 3: Vérifiez les changements d'alerte

### Étape 1: Retournez aux limites de stock
```
URL: http://localhost:3000/dashboard/stock/minimum-levels
```

### Étape 2: Vérifiez le changement de statut

**Avant**: Sauce soja = 🚨 CRITIQUE (Stock 0, Min 10)
**Après**: Sauce soja = ⚡ ALERTE (Stock 50, Min 10)

✅ Le statut doit passer de ROUGE à JAUNE automatiquement!

---

## 🎯 Test 4: Consultez l'historique

### Étape 1: Allez à l'historique
```
URL: http://localhost:3000/dashboard/stock/history
```

### Étape 2: Vérifiez l'enregistrement

Vous devriez voir une ligne:
```
Date: 17/03/2026 HH:MM:SS
Article: Sauce soja
Type: 🥘 Ingrédient
Quantité: +50
Raison: 📦 Réapprovisionnement
Avant: 0
Après: 50
Utilisateur: Vous
```

### Étape 3: Testez les filtres d'historique

- **Filtrer par Type**: Voir uniquement les ingrédients
- **Filtrer par Raison**: Voir uniquement les réapprovisionnements

---

## 🎯 Test 5: Tester le scénario "URGENT"

### Ajustez la Sauce huître (URGENT)

1. **Stock actuel**: 2, **Minimum**: 8
2. **Raison**: Le stock est < 50% du minimum (2 < 4)
3. **Cliquez ✏️ pour éditer le minimum**
4. **Changez à 3** (pour que 2 soit < 50% de 3, soit < 1.5)
5. **Vérifiez** que le statut passe à CRITIQUE (car 2 > 1.5 ne fonctionne pas...)

Essayez plutôt:
1. **Mettez le minimum à 10**
2. **Stock = 2 reste < 50% de 10** = URGENT ✅

---

## 🎯 Test 6: Testez les raisons d'ajustement

### Testez chaque raison en ajustant le môme ingrédient:

| Raison | Description | Quand l'utiliser |
|---|---|---|
| 📦 Réapprovisionnement | Commande reçue | Livraison fournisseur |
| ❌ Dégât/Cassure | Produit cassé | Accident |
| 🔍 Perte/Inventaire | Perte détectée | Inventaire différence |
| 📉 Utilisation en déchet | Utilisé comme déchet | Caramélisation, test |
| ↩️ Retour fournisseur | Retour au fournisseur | Mauvaise qualité |
| ✏️ Correction inventaire | Correction manuelle | Erreur système |

**Variez les raisons** pour des ajustements différents:
1. Ajustez Sauce soja: +10 (Réapprovisionnement)
2. Ajustez Sauce soja: -5 (Utilisation en déchet)
3. Ajustez Sauce soja: -2 (Dégât/Cassure)
4. Vérifiez dans l'historique que **toutes les raisons** s'affichent correctement

---

## ✅ Checklist de test complète

- [ ] **Statuts affichés correctement** (4 couleurs par alerte)
- [ ] **Filtrage par alerte** fonctionne (tous, critique, urgent, alerte, ok)
- [ ] **Édition inline** des minimums sauvegarde
- [ ] **Statut change** après édition du minimum
- [ ] **Ajustement de stock** fonctionne
- [ ] **Nouveau stock calculé** correctement (avant + quantité)
- [ ] **Historique enregistre** l'ajustement
- [ ] **Raisons affichées** avec couleurs correctes
- [ ] **Utilisateur enregistré** dans l'historique
- [ ] **Filtres d'historique** réduisent les résultats
- [ ] **Passages d'état** (rouge → orange → jaune → vert) fonctionnent

---

## 🐛 Dépannage

### Problem: Les statuts ne changent pas
**Solution**: Rafraîchissez la page (F5)

### Problem: L'ajustement ne sauvegarde pas
**Solution**: Vérifiez la console (F12) pour les erreurs API

### Problem: L'historique est vide
**Solution**: Attendez que l'ajustement soit complètement enregistré

### Problem: Les couleurs ne correspondent pas
**Solution**: Vérifiez le calcul: ALERTE si stock ≤ min, URGENT si stock < 50% min

---

## 📊 Infos techniques

**Calcul des statuts:**
```
Status = "CRITIQUE"  si stock = 0
Status = "URGENT"    si 0 < stock < (min * 0.5)
Status = "ALERTE"    si (min * 0.5) ≤ stock ≤ min
Status = "OK"        si stock > min
```

**Routes testées:**
- `GET /api/ingredients` - Récupérer les ingrédients
- `POST /ingredients/{id}/adjust` - Ajuster un ingrédient
- `GET /stock-adjustments` - Voir l'historique
- Les ajustements sont enregistrés avec userId, reason, old_stock, new_stock

---

## 🎉 Résultat attendu

Après tous ces tests, vous devriez avoir:
- ✅ Un système d'alerte fonctionnel avec 4 niveaux
- ✅ Des ajustements de stock traçables
- ✅ Un historique des modifications
- ✅ Une gestion complète des limites minimales

**Bon test!** 🚀
