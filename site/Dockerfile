# Static marketing site — nginx. Build context is the REPO ROOT.
# Railway injects $PORT. nginx:alpine runs envsubst over /etc/nginx/templates/*.template
# at startup and writes the result into /etc/nginx/conf.d/.
FROM nginx:alpine
COPY site/ /usr/share/nginx/html/
RUN rm -f /usr/share/nginx/html/Dockerfile /usr/share/nginx/html/railway.json \
 && mkdir -p /etc/nginx/templates \
 && printf 'server {\n  listen ${PORT};\n  server_name _;\n  root /usr/share/nginx/html;\n  index index.html;\n  location / { try_files $uri $uri.html $uri/ =404; }\n}\n' > /etc/nginx/templates/default.conf.template
ENV PORT=80
EXPOSE 80
