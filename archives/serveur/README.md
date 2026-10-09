# Archive du module serveur

Ce document decrit une etape intermediaire du 8 octobre 2026. Le flux actif
est maintenant la caisse unique decrite dans `../../FLUX_CAISSE.md` ; les
ecrans serveur, cuisine et bar sont desactives et archives.

Copies du 2026-10-08, conservees avant le transfert progressif de la prise de commande vers la caisse.

- `frontend/src/components/StaffDashboard/modules/ServerModules.js` : interface serveur de cette etape.
- `backend/app/Http/Controllers/Api/ServerController.php` : API serveur de cette etape.
- `backend/app/Http/Controllers/ServerDashboardController.php` : ancien controleur serveur.

Ces copies ne sont ni importees par React ni chargees par Laravel. A cette
etape intermediaire, les roles et flux cuisine/bar n'avaient pas encore ete
desactives.

Le composant archive utilise encore les services API, le contexte d'authentification, les utilitaires et le CSS commun du projet. Ce dossier est une sauvegarde du code, pas une application autonome.

La premiere interface caisse utilise seulement les nouvelles routes GET `/api/cashier/order-entry/tables` et `/api/cashier/order-entry/menus`. Ses brouillons sont conserves par compte dans la session du navigateur : aucune commande, consommation de stock ou operation financiere n'est enregistree.

La regle alors prevue a depuis ete implementee : le module cuisine n'est plus
utilise et le stock est retire au premier paiement reel, une seule fois. Les
regles actuelles des paiements partiels sont decrites dans `../../FLUX_CAISSE.md`.
