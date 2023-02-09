# Norppa updater

Sisu updater for Norppa course feedback system

## Development
`docker-compose.yml` includes cofiguration for a development database. Start the dev environment with `npm start` and Norppa's migrations are executed automatically. Importer url can be freely configured to point to the staging/production instance or a local container with the `IMPORTER_API_URL` variable


## Environment configuration
Create a `.env` file inside the project's root directory. In that file, copy the contents of the `.env.template` file and add correct values for the variables based on the documentation.
