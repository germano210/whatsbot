FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /app/server
COPY server/pom.xml ./pom.xml
COPY server/src ./src
RUN mvn -q -DskipTests package

FROM eclipse-temurin:21-jre
WORKDIR /app/server
COPY --from=build /app/server/target/editor-whatsapp-server-0.1.0.jar ./app.jar
COPY dist /app/dist
ENV SERVER_ADDRESS=0.0.0.0
ENV APP_DATA_DIR=/app/server/data
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
