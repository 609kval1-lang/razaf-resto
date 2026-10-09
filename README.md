# Razaf Resto

Application de restaurant : API Laravel 12 et interface React. Le flux actif
utilise les roles **admin** et **caissier**. La caisse gere les commandes,
les encaissements et le stock ; l'administration gere notamment les menus,
matieres premieres, fournisseurs, achats et finances.

Les anciens modules serveur, cuisine et bar sont conserves dans
[`archives/`](archives/) pour consultation uniquement. Ils ne sont pas charges
par l'application active. Voir [`FLUX_CAISSE.md`](FLUX_CAISSE.md) pour les regles
du nouveau parcours et [`backend/CALCULATION_AUDIT.md`](backend/CALCULATION_AUDIT.md)
pour les calculs financiers et de stock.

## Installer sur une autre machine

Prerequis : PHP **8.2+** avec les extensions demandees par Composer, Composer,
Node.js et npm, MySQL/MariaDB et Git. XAMPP peut fournir PHP et MySQL. Le code
Git ne contient ni les dependances installees, ni les fichiers `.env`, ni les
donnees MySQL.

Dans PowerShell, cloner le projet ou mettre a jour une copie existante. Ouvrir
ensuite les terminaux suivants a la racine du clone :

```powershell
git clone https://github.com/609kval1-lang/razaf-resto.git
# Ou, dans une copie deja presente : git pull origin main
```

Installer et configurer l'API :

```powershell
cd .\backend
Copy-Item .env.example .env
composer install
php artisan key:generate
```

Dans `backend/.env`, verifier `DB_HOST`, `DB_PORT`, `DB_DATABASE`,
`DB_USERNAME` et `DB_PASSWORD`. La valeur d'exemple `DB_DATABASE=razaf_resto`
suppose que cette base existe deja dans MySQL. Creer la base vide avant les
migrations si l'installation est neuve. Ne pas copier la cle `APP_KEY` d'une
autre installation si aucune donnee chiffree ne doit etre reprise.

**Base neuve de demonstration uniquement :**

```powershell
php artisan migrate
php artisan db:seed --class=RazafRestoSeeder
```

Le seeder cree des utilisateurs et du stock fictifs. Le compte de demonstration
est `admin@razaf.com` avec le mot de passe `admin123` : le changer avant tout
usage reel. Ne jamais executer ce seeder sur une base contenant des donnees
reelles, car il remet a jour des lignes existantes.

**Reprise d'une base existante :** faire une sauvegarde SQL sur l'ancienne
machine, l'importer dans la base de la nouvelle machine, puis verifier
`php artisan migrate:status`. Examiner les migrations en attente avant de lancer
`php artisan migrate` : certaines anciennes migrations peuvent modifier des
donnees. Ne pas executer `migrate:fresh`, `migrate:refresh` ou les seeders sur
une base de production. Si des donnees chiffrees doivent etre relues, reprendre
aussi l'ancienne `APP_KEY` dans le `.env` de la nouvelle machine.

Installer et lancer le frontend dans un second terminal :

```powershell
cd .\frontend
npm ci
npm start
```

Lancer l'API dans le premier terminal depuis `backend` :

```powershell
php artisan serve
```

Ouvrir `http://localhost:3000`. L'API tourne par defaut sur
`http://localhost:8000`. L'interface deduit automatiquement cette adresse ; un
`frontend/.env` n'est normalement pas necessaire. Pour une adresse differente,
creer ce fichier local avec `REACT_APP_API_URL=http://ADRESSE:PORT/api`, puis
redemarrer le frontend. Ce fichier n'est pas versionne.

Pour acceder depuis un autre appareil du reseau, demarrer l'API avec
`php artisan serve --host=0.0.0.0`, rendre le frontend accessible sur le
reseau, et ajouter son origine exacte (par exemple
`http://192.168.1.10:3000`) a `CORS_ALLOWED_ORIGINS` dans `backend/.env`,
separee des autres par une virgule. Redemarrer l'API apres modification ; si la
configuration Laravel est en cache, executer `php artisan config:clear`.
Ouvrir uniquement les ports necessaires dans le pare-feu et ne pas exposer les
serveurs de developpement directement sur Internet.

## Verifier

```powershell
# Dans backend
php artisan test
php artisan route:list --path=api

# Dans frontend
npm test -- --watchAll=false --runInBand
npm run build
```

En cas d'echec au demarrage, verifier que MySQL est lance, que les parametres
`DB_*` correspondent a la base, que `composer install` et `npm ci` ont termine,
et que les ports 8000 et 3000 sont libres. Les archives ne doivent pas etre
copiees dans `backend/app` ou `frontend/src` pour installer cette version.
