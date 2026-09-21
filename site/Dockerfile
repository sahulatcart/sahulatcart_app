# Static marketing site — nginx, Railway-compatible (honors $PORT).
# Build context is the REPO ROOT (so one Railway service config style works for
# every service here); copy only the site folder into the image.
FROM nginx:alpine
COPY site/ /usr/share/nginx/html/
RUN rm -f /usr/share/nginx/html/Dockerfile /usr/share/nginx/html/railway.json
CMD ["sh", "-c", "sed -i \"s/listen  *80;/listen ${PORT:-80};/\" /etc/nginx/conf.d/default.conf && nginx -g 'daemon off;'"]
