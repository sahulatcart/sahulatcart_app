# Static marketing site — nginx, Railway-compatible (honors $PORT).
FROM nginx:alpine
COPY . /usr/share/nginx/html
RUN rm -f /usr/share/nginx/html/Dockerfile
CMD ["sh", "-c", "sed -i \"s/listen  *80;/listen ${PORT:-80};/\" /etc/nginx/conf.d/default.conf && nginx -g 'daemon off;'"]
