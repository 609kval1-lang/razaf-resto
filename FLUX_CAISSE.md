# Flux actif : caisse unique

## Parcours

- Seuls les acces admin et caisse sont actifs. Les anciens comptes restent en base.
- Navigation caisse et actions du compte : bandeau superieur, sans menu lateral.
- Le tableau de bord reunit les indicateurs et les disponibilites des plats.
  Les tables sont affichees uniquement dans Commandes.
- Cinq indicateurs : CA du jour, caisse disponible, nombre de clients, Boissons
  et Plats. Le nombre de clients compte les additions distinctes encaissees
  dans la journee, sans doubler les paiements partiels. Boissons inclut les
  cocktails et boissons alcoolisees ; Plats regroupe le reste du CA, barquettes
  comprises. Boissons + Plats correspond au CA du jour.
- Les disponibilites sont sous les indicateurs, puis viennent la repartition
  des encaissements et les douze paiements clients les plus recents du jour.
  Les encaissements affichent l'argent nouvellement recu, hors credit d'acompte.
  Les limites de journee caisse suivent Indian/Antananarivo, sans changer les
  dates en base ni les historiques disponibles dans l'administration.
- Commandes : choisir une table, A emporter ou Autres, puis les plats,
  puis le recapitulatif et le paiement. Les commandes sans table restent accessibles.
- La vue des tables distingue tables libres, commandes en cours, reservations
  et brouillons. Les filtres d'etat et de recherche restent locaux.
- Les emplacements ne sont plus affiches ni proposes dans les formulaires.
  Les anciennes valeurs de `tables.section` restent en base et ne sont pas
  ecrasees lors d'une modification de capacite ou de reservation.
- Une commande en cours affiche son numero, son nombre d'articles et son
  montant brut d'addition. Ce montant n'est pas un nouvel encaissement.
- Le catalogue est pagine par 12 plats et charge seulement apres le choix de la table.
- Le catalogue utilise des cartes compactes et des filtres de categorie.
  Le panier reste visible a droite sur ordinateur ; sur mobile, la barre
  de total et de recapitulatif reste accessible en bas de l'ecran.
- Une table occupee ouvre son paiement existant, sans creer de seconde commande.
- Les brouillons restent dans la session du navigateur, separes par compte et par table.
- La confirmation enregistre les prix et les besoins de recette cote backend.
  Elle ne retire pas de stock et n'encaisse pas d'argent.
- Autres permet une addition libre nommee, le regroupement de commandes
  existantes et leur division par table ou quantites de plats. Un recapitulatif
  est obligatoire avant confirmation. Les sources sont archivees, pas supprimees.
- Une repartition est autorisee uniquement sans paiement, document imprime,
  bon ou stock deja consomme. Les prix et recettes figes restent inchanges.
  Chaque nouvelle addition conserve son propre marqueur de consommation ;
  les tables associees restent occupees tant qu'une addition les occupe.
- Les anciens etats `served` sont conserves pour compatibilite avec les historiques ;
  ils ne representent plus une validation par la cuisine ou le bar.

## Stock Et Paiements

- Le stock brut est la source de verite. Les portions partageant une matiere
  premiere ne constituent pas plusieurs stocks independants.
- L'admin peut preparer une recette meme en rupture de stock. Le catalogue admin
  distingue la mise au catalogue de la capacite reellement commandable, calculee
  depuis les matieres brutes. La caisse refuse toujours une commande sans recette
  valide ou un paiement sans stock suffisant.
- Capacite d'un plat : minimum des stocks bruts divises par les besoins cumules
  de sa recette, arrondis a l'entier inferieur.
- Les besoins de tous les plats du panier sont cumules sur chaque matiere.
- Disponibilites, dans le tableau de bord, affiche le nom, l'etat et la quantite
  disponible de chaque plat. Chargement a l'ouverture, actualisation apres commande ou paiement
  et sur demande ; aucun polling. Les depots seuls ne rechargent pas le stock.
  Les capacites de plats partageant un stock ne s'additionnent pas.
- Les compteurs de Disponibilites comptent des plats distincts, pas la somme
  des capacites. Le titre, la recherche, la categorie, l'etat et Actualiser
  sont reunis dans un seul bandeau sur ordinateur, adapte aux petits ecrans.
  Le repere visuel "Stock faible" signifie 5 services ou moins ; ce n'est
  ni une nouvelle regle de consommation, ni une notification.
- Les ingredients et leurs quantites disponibles se consultent a la demande
  dans chaque carte. La raison d'une indisponibilite est conservee dans ce detail.
- Les pages actives d'administration, de caisse et de connexion partagent
  le theme `RestaurantWorkspace.css`. L'administration et la caisse utilisent
  le meme bandeau de navigation `WorkspaceHeader`. Les ecrans affichent des libelles
  courts, sans paragraphes de presentation ou d'explication du flux.
  Les erreurs, soldes, reliquats et informations operationnelles restent visibles.
- Aucun son, notification navigateur ou alerte d'addition du flux archive.
  Les messages de succes et d'erreur des actions restent affiches.
- Au premier paiement reel, meme partiel, tout le stock de la commande est
  soustrait une seule fois. `stock_deducted_at` empeche une seconde consommation.
- Une preparation de facture ou l'emission d'un bon seul ne consomme rien.
- Stock, portions, paiement et mouvement de tresorerie sont enregistres dans
  une meme transaction. Les stocks sont verrouilles et reverifies au paiement.
  Un manque de stock refuse l'encaissement, sans stock negatif ni mouvement d'argent.
- Cash credite la caisse, Mobile Money son compte, virement et cheque la banque.
- L'admin peut enregistrer un achat d'une matiere existante depuis la page
  Matieres premieres ou depuis le suivi fournisseur. Un achat augmente le stock
  et enregistre dette et paiement initial dans une transaction. L'admin choisit
  a chaque achat si son prix unitaire devient le cout de reference : si oui,
  les couts d'ingredients et les marges sont recalcules, mais les prix de vente
  ne changent pas automatiquement. Si l'achat est paye integralement, le compte
  debite reste visible et est confirme avant l'enregistrement.
- Dans le formulaire de menu, le prix de vente deja existant affiche maintenant
  la marge sur cout estimee en direct a partir des ingredients de la recette.
  C'est un apercu ; seul le prix saisi est enregistre lors de la validation.
- Les cartes CA Plats/Boissons de l'admin et de la caisse utilisent la meme
  repartition et la journee Indian/Antananarivo. Les rapports admin du jour
  suivent cette journee ; les autres periodes et historiques restent disponibles.
  Dans Recettes & analyse, les remises apparaissent separement du net ; les
  recommandations de prix restent des decisions manuelles.
- Un UUID de validation empeche de recreer la commande apres une reprise reseau.
- Les commandes historiques sont marquees `legacy` : leur stock avait deja ete
  retire dans l'ancien flux. Le paiement ne le soustrait pas une seconde fois.
  Leur reprise en caisse ne depend plus d'une action serveur, cuisine ou bar.

## Montants En Ariary

- Prix et montants saisis des nouvelles operations : Ariary entiers, sans decimales.
- Les saisies fractionnaires sont refusees pour eviter un arrondi implicite.
- Un total d'achat issu d'une quantite fractionnaire est arrondi une seule fois
  a l'Ariary le plus proche, 0,5 vers le haut, cote formulaire comme cote backend.
- Les quantites, portions, couts intermediaires et pourcentages gardent leur precision.
- Les anciens achats, paiements et soldes ne sont pas recalcules.
  Une ancienne dette fournisseur fractionnaire peut etre soldee exactement.
- L'affichage financier ne montre pas de decimales ; la base garde les anciens
  montants exacts pour ne pas perdre ou inventer d'argent dans l'historique.

## Operations Hors Commande

- Operations de caisse reunit demandes de sortie, encaissement des bons et
  acomptes de reservation. L'approbation des sorties reste reservee a l'admin.
- Montant remis et monnaie a rendre sont exclusivement en memoire React :
  aucun envoi API, aucune ecriture en base ou dans le stockage navigateur.
  Le montant reel de la vente ne change pas avec la somme remise.
- Chaque acompte est un mouvement de tresorerie approuve, type deposit,
  flux reservation_deposit, vers le compte du mode d'encaissement choisi.
  Un UUID de recu rend la reprise reseau idempotente. Il ne consomme aucun stock.
- Le paiement de l'addition selectionne explicitement l'acompte (client,
  date et table). L'identite de l'acompte survit a la liberation de la table.
- L'impression reserve un credit, sans le consommer. La validation applique
  le credit et le stock dans la meme transaction. Seul le solde cree une nouvelle
  entree d'argent. Si l'acompte couvre l'addition, aucun second mouvement n'est cree.
- Payment.amount conserve la valeur reglee de la vente ; deposit_amount
  identifie le credit deja encaisse. collected_amount est le nouvel encaissement.
  Le CA reconnait la vente lors du reglement, pas lors du depot de reservation.
- Un excedent d'acompte reste disponible ; aucun remboursement automatique.
  Annulation, transfert d'acompte et remboursement restent a definir.

## Fichiers Principaux

- `frontend/src/components/StaffDashboard/modules/CashierOrdersModule.js`
- `frontend/src/components/StaffDashboard/modules/CashierDashboardModule.js`
- `frontend/src/components/StaffDashboard/modules/CashierOperationsModule.js`
- `frontend/src/components/StaffDashboard/modules/CashierOtherAdditions.js`
- `frontend/src/components/StaffDashboard/CashierShell.css`
- `frontend/src/components/StaffDashboard/modules/CashierAvailabilityModule.js`
- `frontend/src/components/StaffDashboard/modules/CashierModules.js`
- `frontend/src/components/StaffDashboard/modules/CashierWorkspace.css`
- `frontend/src/components/common/RestaurantWorkspace.css`
- `backend/app/Http/Controllers/Api/CashierOrderEntryController.php`
- `backend/app/Services/OrderStockService.php`
- `backend/app/Http/Controllers/Api/CashierController.php`

## Base Locale Et Verification

Lors des verifications du 8 octobre 2026, les trois migrations de cette date
ont ete appliquees a la base locale avec accord explicite. Les deux premieres
ont conserve les valeurs des stocks et les anciennes lignes de neuf tables.
La migration `2026_10_08_020000_add_cashier_operations.php` a conserve les
146 commandes, 127 paiements, 67 mouvements, 39 valeurs de stock et le total
historique des mouvements. Les anciennes pertes d'arrondi ne sont pas
reconstituees. Verifier l'etat des migrations sur chaque autre base.

```powershell
cd backend
php artisan test
cd ../frontend
npm.cmd test -- --watchAll=false --runInBand
npm.cmd run build
```

Les tests backend utilisent SQLite en memoire. Les verrous simultanes MySQL
restent a verifier par un essai d'integration ; aucune comptabilite reelle n'a
ete rapprochee avec les comptes externes.

## Archives

Le flux precedent et ses tests sont conserves dans `archives/flux-precedent/`.
La premiere archive serveur reste dans `archives/serveur/`.
La presentation avec emplacements est conservee dans
`archives/flux-precedent/interface-zones/` et n'est pas importee par les ecrans actifs.
Les anciens guides de ce depot peuvent encore decrire le flux historique ;
ce document est la reference du parcours actif.

Restaurer les anciens ecrans ne suffit pas : il faut aussi adapter la regle de
consommation du stock. Ne pas retirer les marqueurs ou reactiver la consommation
a la saisie sur des commandes deja encaissees.
