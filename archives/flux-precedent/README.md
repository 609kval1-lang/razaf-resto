# Archive Du Flux Precedent

Copies des fichiers avant le passage a la caisse unique, avec les modules
serveur, cuisine, bar, les notifications et les tests de leurs anciennes routes.
Les fichiers partages (caisse, roles, routes, connexion, modele Order et API)
sont des instantanes, pas des fichiers utilises par l'application active.

Aucun compte ni historique n'a ete supprime en base. Les anciens roles restent
consultables par l'administration, mais leurs acces ecran sont desactives.
Une reaffectation admin ou caisse doit etre faite explicitement par l'admin.

Les anciens tests ne sont plus executes par PHPUnit car ils ciblent des routes
archivees. Les tests du flux actif sont dans `backend/tests/Feature/`.

Voir `../../FLUX_CAISSE.md` pour le nouveau parcours et ses regles de stock.
Une restauration doit traiter les nouvelles commandes, les paiements partiels
et les marqueurs `checkout_source` / `stock_deducted_at` pour eviter de retirer
le stock deux fois. Ne pas simplement recopier tous les instantanes sur la base active.
