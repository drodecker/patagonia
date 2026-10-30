FROM nginx:alpine

# envsubst lives in gettext
RUN apk add --no-cache gettext

COPY index.html styles.css app.js itinerary.csv itinerary.json flights.csv flights.json config.js.template /usr/share/nginx/html/

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY docker-entrypoint.sh /docker-entrypoint-patagonia.sh
RUN chmod +x /docker-entrypoint-patagonia.sh

# Default nginx serves /usr/share/nginx/html on :80
EXPOSE 80

ENTRYPOINT ["/docker-entrypoint-patagonia.sh"]
CMD ["nginx", "-g", "daemon off;"]
