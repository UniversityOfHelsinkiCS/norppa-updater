![Norppa](https://emojipedia-us.s3.dualstack.us-west-1.amazonaws.com/thumbs/120/google/313/seal_1f9ad.png)
# Norppa updater ![Release](https://github.com/UniversityOfHelsinkiCS/norppa-updater/actions/workflows/production.yml/badge.svg) ![Release](https://github.com/UniversityOfHelsinkiCS/norppa-updater/actions/workflows/staging.yml/badge.svg)

Sisu updater for Norppa course feedback system

## Development
`docker-compose.yml` includes cofiguration for a development database.

Start the dev environment with `npm start` and Norppa's migrations are executed automatically.

Importer url can be freely configured to point to the staging/production instance or a local container with the `IMPORTER_API_URL` variable.


## Environment configuration
Create a `.env` file inside the project's root directory. In that file, copy the contents of the `.env.template` file and add correct values for the variables based on the documentation.
