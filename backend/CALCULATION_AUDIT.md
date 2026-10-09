# Audit des calculs - 8 octobre 2026

## Perimetre

Stocks et portions de l'administration, achats et dettes fournisseurs,
encaissements clients, remises, caisse, coffre, Mobile Money, banque,
transferts, sorties, avances et salaires.

Le theme CSS du nouveau flux caisse est conserve et reutilise cote
administration. Le retrait du stock au premier paiement reel est actif :
voir `../FLUX_CAISSE.md`.
Le flux serveur, cuisine et bar est conserve dans `../archives/flux-precedent/`.

## Regles verifiees

- Portion disponible = partie entiere du stock converti / taille de portion.
  Une tolerance numerique tres faible corrige les divisions exactes en flottant.
- Cout par portion = prix de l'unite brute * portion convertie dans cette unite.
- Plusieurs ingredients issus d'une meme matiere partagent son stock.
  `available_portions_total` reste la cle historique de l'API, mais represente
  maintenant la capacite maximale avec la plus petite portion, pas leur somme.
  Exemple : 20 pieces donnent au maximum 10 portions de 2, ou 4 portions de 5,
  et non 14 portions simultanement disponibles.
- Les achats utilisent trois decimales de quantite, les tailles de portion deux.
  Le stock conserve six decimales pour les restes apres conversion kg/g ou L/ml.
  Les precisions non prises en charge sont refusees plutot qu'arrondies en silence.
- Un achat de matiere existante peut, sur choix explicite de l'admin, remplacer
  son cout de reference par le prix d'achat. Le stock, l'achat, le paiement
  initial eventuel, l'historique de prix et les couts d'ingredients sont traites
  dans la transaction ; un refus de paiement annule tout. Le prix des plats
  reste inchange tant que l'admin ne le modifie pas.
- La creation d'une recette n'exige plus que la matiere soit en stock. La
  disponibilite reelle est calculee depuis le stock brut et reverifiee en caisse.
- Les nouveaux prix et montants saisis sont des Ariary entiers : achats,
  paiements, sorties, transferts, salaires et avances. Une saisie fractionnaire
  est refusee, pas arrondie silencieusement.
- Total d'un nouvel achat = quantite * prix unitaire, arrondi une seule fois
  a l'Ariary le plus proche, avec 0,5 vers le haut. Le calcul du formulaire
  et celui du backend utilisent la meme regle ; la quantite n'est pas arrondie
  a un entier. Exemple : 0,003 kg * 500 Ar/kg = 2 Ar, et 0,003 kg en stock.
  Total = paye + restant. Le paiement initial ne peut pas depasser le total.
  Un total arrondi a 0 Ar est refuse, sans creer de matiere ni de fournisseur.
- Les anciens montants et soldes fractionnaires ne sont pas reecrits.
  Une ancienne dette fournisseur reste reglable pour son reliquat exact.
  Les colonnes monetaires gardent leur precision pour conserver cet historique.
- Les montants affiches sont sans decimales. Les calculs intermediaires de cout
  par portion, de marge et de ventilation gardent leur precision avant affichage.
  Les quantites de stock et les pourcentages ne sont pas des montants monetaires.
- Un achat refuse n'enregistre ni stock, ni paiement, ni liaison fournisseur.
  Un reglement global qui echoue annule egalement les premiers paiements du lot.
- Solde d'un compte = entrees approuvees - sorties approuvees.
  Un transfert debite une source et credite une destination du meme montant.
  Il ne change pas la somme des quatre comptes.
- Cash fournisseur/salaire debite caisse ou coffre ; Mobile Money debite
  `mobile_money` ; virement et cheque debitent `bank`.
  L'ancien alias `card` est normalise en Mobile Money pour les fournisseurs.
- Une demande de sortie en attente ou refusee ne reduit pas le solde.
  Le solde est recontrole au moment de l'approbation.
- Une avance salariale est decaissee une fois. Sa deduction du salaire reduit
  le salaire net sans provoquer un second decaissement de l'avance.
- Les ventes sont arrondies en Ariary entiers. La repartition proportionnelle
  distribue les Ariary restants au lieu d'arrondir chaque ligne independamment.
- Le rapport de recettes conserve sa logique d'encaissements : brut = net +
  remises des paiements encaisses dans la periode, emballages inclus.
  La vue admin ventile le net entre Plats (emballages compris) et Boissons
  (cocktails compris) ; ces deux montants se reconciliant au net total.
  Le classement affiche aussi le net et la remise attribues a chaque menu,
  tandis que le brut reste disponible dans l'API pour l'audit.
  Les paiements fractionnes repartissent les couts au prorata du brut encaisse,
  pour ne pas reprendre le cout integral a chaque date de paiement.
- Benefice global estime = net encaisse - cout estime des ingredients.
  Le benefice par menu tient compte de la remise affectee a ce menu.

## Flux Caisse Verifie

- Une seule caisse active : table, catalogue pagine, recapitulatif, paiement.
  Aucun passage obligatoire par serveur, cuisine ou bar ; leurs routes et
  notifications sont desactivees et leurs fichiers conserves dans les archives.
- La confirmation de commande fige les prix et la recette cote backend,
  mais ne consomme pas le stock et n'enregistre aucun encaissement.
- Tout le stock est retire une seule fois au premier paiement reel, meme
  partiel. Un bon seul ou une preparation de facture ne declenche rien.
- Les besoins sont cumules par matiere, meme si plusieurs portions ou plats
  l'utilisent. Le stock brut prime sur les compteurs de portions historiques.
- Une commande et ses matieres sont verrouillees au paiement. Un manque de
  stock annule paiement, mouvement d'argent et consommation dans la meme transaction.
- Plusieurs tables de cette meme caisse peuvent partager un stock : le paiement
  de la seconde commande est reverifie apres celui de la premiere. Ce cas est teste.
- Le paiement du reliquat, les doubles clics et les reprises reseau ne recreent
  ni commande, ni consommation, ni mouvement d'argent deja valide.
- Les commandes `legacy` restent encaissables sans soustraire de nouveau le
  stock retire a leur creation dans l'ancien flux.
- Disponibilites : chargement a l'ouverture, puis actualisation apres une
  commande ou un paiement, ou sur demande. Aucun polling ; les seuls acomptes
  ne rechargent pas le stock. Les capacites des plats partageant un stock ne
  s'additionnent pas.
- Les trois migrations du 8 octobre ont ete appliquees sur la base locale
  utilisee lors de ce controle. Les valeurs des anciens stocks ont ete
  comparees avant/apres. Leur etat sur une autre base reste a verifier.

## Portee Du Controle

- Les tests automatises utilisent SQLite en memoire. La migration et les lectures
  ont aussi ete verifiees sur la base locale MySQL, mais pas un test de charge
  avec plusieurs requetes reellement simultanees. Cela ne signifie pas qu'il
  reste un passage serveur/cuisine ou une consommation a implementer.
- Aucun rapprochement avec l'argent physique, les releves bancaires ou Mobile
  Money n'a ete fait. Ce controle valide les calculs du logiciel, pas les comptes reels.
- Les quantites perdues avant la migration par un ancien arrondi ne peuvent
  pas etre reconstituees sans justificatif.
- Les couts des menus restent des estimations au prix de reference actuel de
  la matiere, pas des couts historiques figes ni une valorisation FIFO/CUMP.
  Le benefice estime n'est pas le resultat comptable apres salaires, charges
  et cout des emballages, dont le prix de revient n'est pas renseigne.
- Les quantites de menus/barquettes du rapport sont celles des commandes
  concernees par un encaissement. Elles ne doivent pas etre additionnees entre
  plusieurs jours de paiement d'une meme commande comme de nouvelles ventes.
- La ventilation restaurant/boissons/cocktails exclut les recettes d'emballage.
  Les soldes de tresorerie et le rapport global, eux, comprennent ces recettes.
- Les cartes CA admin regroupent maintenant boissons et cocktails ; les
  emballages restent dans Plats. Leur journee et celle du rapport admin en mode
  jour suivent Indian/Antananarivo, sans conversion des dates stockees.

## Verification

```powershell
cd backend
php artisan test
cd ../frontend
npm.cmd test -- --watchAll=false --runInBand
npm.cmd run build
```

Les nouveaux tests sont dans `StockCalculationTest`, `MoneyCalculationTest`,
`WholeAriaryTest`, `CashierCheckoutStockTest`, `AriaryTest` et les tests frontend
du flux caisse et des montants Ariary.
Verification du 8 octobre : 117 tests backend (1388 assertions), 40 tests
frontend. Verification du 9 octobre : 63 tests frontend ; build valide avec
cinq avertissements de variables inutilisees deja presents. Les tests backend
n'ont pas ete relances lors de cette derniere verification.
Le test CRUD devenu obsolete a ete
aligne sur l'achat fournisseur initial, sans enlever la dependance fournisseur.
