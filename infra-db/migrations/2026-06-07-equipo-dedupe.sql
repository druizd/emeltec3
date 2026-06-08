-- La deduplicacion de las cargas FTP se aplica en ftpconsumer antes de insertar.
-- No hacemos limpieza historica aqui porque equipo puede estar comprimida en
-- TimescaleDB y un DELETE masivo fuerza descompresion de demasiadas tuplas.

SELECT 1;
