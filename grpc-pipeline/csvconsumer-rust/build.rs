// Script de build de Cargo. Se ejecuta antes de compilar `src/`.
//
// Su único trabajo es generar el código Rust correspondiente al
// archivo `../proto/logpipeline.proto` usando `tonic-build`.
//
// La salida se escribe en `$OUT_DIR` (carpeta de build de Cargo) y
// el código de `src/main.rs` la importa con:
//     tonic::include_proto!("logpipeline");
//
// Requisitos en tiempo de build:
//   - `protoc` (Protocol Buffers compiler) instalado en el sistema.
//     El Dockerfile lo agrega con `apt-get install protobuf-compiler`.

fn main() -> Result<(), Box<dyn std::error::Error>> {
    tonic_build::configure()
        // Generar el lado servidor (trait LogIngestion + LogIngestionServer).
        .build_server(true)
        // No generamos cliente: este crate solo expone el servidor.
        .build_client(false)
        // Compilamos el .proto. Segundo argumento = include paths para
        // resolver `import` dentro del proto (no usamos imports aquí,
        // pero `tonic-build` requiere la ruta de todas formas).
        .compile_protos(&["../proto/logpipeline.proto"], &["../proto"])?;
    Ok(())
}
