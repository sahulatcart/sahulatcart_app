# Static marketing site — nginx. Build context is the REPO ROOT.
#
# The config is copied straight into /etc/nginx/conf.d/. It is NOT left as a
# template in /etc/nginx/templates/: Railway's custom start command replaces the
# image's ENTRYPOINT, so /docker-entrypoint.sh (which runs envsubst over
# templates) never executes. A template there is silently ignored and nginx
# falls back to its stock default — which is why try_files never worked.
FROM nginx:alpine

COPY site/ /usr/share/nginx/html/
COPY site/nginx.conf /etc/nginx/conf.d/default.conf

# Files that belong to the build, not the document root.
RUN rm -f /usr/share/nginx/html/Dockerfile \
          /usr/share/nginx/html/railway.json \
          /usr/share/nginx/html/nginx.conf \
 && nginx -t

ENV PORT=80
EXPOSE 80
