<div align="center">

[English](README.md) · [简体中文](README.zh-CN.md) · [日本語](README.ja.md) · **Español** · [한국어](README.ko.md)

<img src="resources/branding/logo.png" width="112" alt="Logotipo de Wanta" />

# Wanta

**Un host de escritorio abierto para tus modelos, tus agentes, tus aplicaciones y tus equipos.**

Ejecuta el agente integrado con modelos alojados por Wanta o con tu propia clave API compatible con
OpenAI. También puedes incorporar Claude Code, Codex y Grok con sus cuentas locales, catálogos de
modelos y cuotas nativas. Wanta reúne herramientas locales, Skills, navegador, conocimiento,
conexiones gobernadas, ejecución visible y artefactos en un entorno multiplataforma. Conecta más de
1.400 aplicaciones populares para incorporar a un mismo flujo de agente los servicios que ya usas.

[Sitio web](https://wanta.ai/) · [OpenConnector](https://github.com/oomol-lab/open-connector) ·
[Documentación](docs/project-overview.md) · [Guía de desarrollo](docs/development.md)

[![Licencia: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)
![Node.js 22.22.2+](https://img.shields.io/badge/Node.js-22.22.2%2B-339933)

</div>

<p align="center">
  <img src="docs/assets/wanta-gmail-analysis.png" alt="Wanta analizando Gmail con herramientas conectadas y mostrando el artefacto de hoja de cálculo resultante" />
</p>

<p align="center"><em>De una tarea en un servicio conectado a un artefacto interactivo y reutilizable, dentro del mismo espacio de trabajo.</em></p>

<p align="center"><strong>Modelos BYOK · Agentes BYOA · Más de 1.400 aplicaciones populares · Reglas de permisos de equipo</strong></p>

## Por qué elegir Wanta

Wanta ha sido creado por [OOMOL](https://oomol.com/) para quienes quieren controlar la pila completa
del agente, sin quedar atados a un producto cerrado que combine modelo, Agent Harness, integraciones
y permisos.

| Tú controlas         | Wanta proporciona                                                                                                                                                          |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Tus modelos**      | Modelos alojados por Wanta o el agente integrado con tu propia clave API compatible con OpenAI.                                                                            |
| **Tus agentes**      | El agente integrado, Claude Code, Codex o Grok en el mismo host. Los agentes externos conservan sus cuentas locales, modelos y cuotas nativas.                             |
| **Tus aplicaciones** | Conecta más de 1.400 aplicaciones populares que cubren el trabajo diario y descubre progresivamente más de 10.000 Actions sin cargar miles de herramientas en el contexto. |
| **Tus equipos**      | Espacios personales y de equipo, Connections y Skills compartidas, y reglas con nombre y acceso por Action.                                                                |

Wanta aporta proyectos, herramientas locales, Skills, navegador, conocimiento, Connections, permisos,
actividad visible y artefactos. Cada agente externo conserva sus capacidades nativas, y la interfaz
solo muestra los controles que realmente declara.

Wanta también es una base de escritorio de código abierto y reutilizable. Haz un fork, sustituye
instrucciones, herramientas, conectores, interfaz y marca, y publica un agente para tu producto.

También puedes usar Wanta tal como está: ejecútalo localmente con tu propio modelo compatible con
OpenAI o inicia sesión para usar modelos alojados por OOMOL, conectores, autorización OAuth y espacios
de trabajo de equipo.

## Por qué hicimos Wanta de código abierto

Una demostración convincente de un agente puede comenzar con un modelo y un campo de chat. Un agente
de escritorio en el que se pueda confiar necesita mucho más: gestión del ciclo de vida del runtime,
eventos en streaming, controles de acceso local, credenciales seguras para modelos, sesiones y
proyectos, actividad de herramientas, archivos como artefactos, recuperación, empaquetado y una
interfaz que permita comprender el trabajo autónomo.

Nadie debería tener que reconstruir todo eso antes de trabajar en la capacidad que hace único a su
agente. Wanta abre la base de escritorio completa para que puedas:

- alojar varios runtimes de agente tras una experiencia de escritorio basada en capacidades;
- crear herramientas, Skills, instrucciones y flujos de trabajo específicos de un dominio;
- combinar trabajo local en el equipo con acciones SaaS autenticadas;
- distribuir un producto de escritorio con tu marca, no solo un prototipo para desarrolladores;
- elegir cuánta infraestructura quieres operar por tu cuenta.

## Qué puedes crear

Wanta es hoy un agente de trabajo general, pero su arquitectura está pensada para adaptarse. Puede
convertirse en un agente de operaciones, investigación, soporte, comercio electrónico o conocimiento
empresarial, una herramienta interna u otro producto de escritorio vertical.

| Punto de partida                                                                 | Hazlo tuyo                                                              |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Runtime OpenCode integrado y adaptadores para Claude Code, Codex y Grok          | Añade otro agente ACP mediante la capa de adaptadores con registro      |
| Archivos locales, shell, scripts, búsqueda y acceso web                          | Añade herramientas para tu producto, sector o sistemas internos         |
| Modelos personalizados compatibles con OpenAI y modelos alojados por OOMOL       | Incorpora tu propio catálogo de modelos y proveedores predeterminados   |
| Chat en streaming, actividad de herramientas, aprobaciones, preguntas y adjuntos | Rediseña el flujo de trabajo conservando la integración con el runtime  |
| Gestión de los artefactos generados                                              | Añade resultados, vistas previas y acciones específicas del producto    |
| Empaquetado y actualizaciones multiplataforma con Electron                       | Aplica tu nombre, identidad, distribución y proceso de publicación      |
| Descubrimiento y ejecución de acciones SaaS compatibles con OpenConnector        | Conecta tus propios Providers o usa el ecosistema alojado de conectores |

## Wanta en acción

Wanta puede razonar, inspeccionar proyectos y archivos, ejecutar comandos y scripts, acceder a la web
y usar acciones SaaS autenticadas cuando una tarea necesita datos privados de una cuenta. La ejecución
de herramientas se muestra en streaming dentro de la conversación para que la persona vea qué hace el agente.

Las acciones locales de alto riesgo pasan por un flujo de permisos explícito. El agente también puede
detenerse para solicitar información mediante preguntas estructuradas. Los modos Build y Plan ofrecen
contratos de ejecución distintos, y se puede elegir el modelo, nivel de razonamiento, proyecto y modo
de acceso para cada tarea.

Los archivos generados permanecen vinculados a la tarea en vez de perderse en la conversación. Wanta
puede abrir y revisar código, texto, imágenes, PDF, documentos de Word y libros de cálculo interactivos
completos en el panel de artefactos.

La experiencia alojada opcional añade conexiones administradas y espacios de equipo sin entregar al
agente las credenciales almacenadas de los Providers. Los equipos pueden compartir Connections y
Skills, crear reglas de permisos con nombre, asignar miembros y limitar Actions por regla.

## Trae tu propio agente

Wanta incluye cuatro opciones: el agente integrado, Claude Code, Codex y Grok. El agente integrado usa
el catálogo de modelos de Wanta y admite BYOK. Los agentes externos se autentican mediante su propia
CLI local y usan exclusivamente su ruta de Provider, catálogo de modelos y cuota nativos. Wanta nunca
les inyecta su token de cuenta, clave BYOK, Base URL ni alias de modelo.

| Agente           | Propietario del modelo y la cuenta                                       | Capacidades del host Wanta                                                     |
| ---------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| Agente integrado | Modelos alojados por Wanta o tu configuración BYOK compatible con OpenAI | Integración completa con el runtime y el host de Wanta                         |
| Claude Code      | Tu cuenta local de Claude Code y su catálogo nativo                      | Proyectos, Skills, Connections, navegador, conocimiento, permisos y artefactos |
| Codex            | Tu cuenta local de Codex y su catálogo nativo                            | Proyectos, Skills, Connections, navegador, conocimiento, permisos y artefactos |
| Grok             | Tu cuenta local de Grok y su catálogo nativo                             | Proyectos, Skills, Connections, navegador, conocimiento, permisos y artefactos |

La capa BYOA usa un contrato de adaptadores normalizado y denegado por defecto. Las nuevas integraciones
ACP se registran de forma declarativa; las capacidades y pruebas de contrato mantienen honestos el
comportamiento del runtime y los controles de la interfaz.

## Conecta tu trabajo

Wanta conecta más de 1.400 aplicaciones populares de comunicación, productividad, desarrollo,
analítica, comercio, almacenamiento y muchas otras categorías mediante el ecosistema compartido de
OpenConnector, con más de 10.000 Actions predefinidas. Así cubre los servicios de uso diario sin
registrar una pared de herramientas en cada prompt: el agente enumera aplicaciones, busca una Action,
inspecciona su esquema, valida la entrada y la ejecuta progresivamente.

Los tokens OAuth y las credenciales API permanecen en OOMOL Connector o en tu despliegue de
OpenConnector. Los agentes reciben los metadatos y resultados necesarios, no los secretos almacenados.
El mismo flujo gobernado está disponible para todos los agentes compatibles.

## Gobierna el trabajo en equipo

Cambia entre un espacio personal y varios espacios de equipo sin mezclar sesiones, Connections,
Skills ni permisos. Los creadores y administradores pueden compartir una Connection con todo el equipo
o crear reglas con nombre, asignar miembros, limitar Actions y configurar ámbitos específicos del
Provider. Los miembros ordinarios solo ven las Connections permitidas por la política.

Las políticas incorrectas fallan de forma cerrada y las ediciones simultáneas usan escrituras
protegidas por versión para evitar sobrescribir cambios más recientes.

## Elige tu opción

Wanta separa la base de escritorio de código abierto de los servicios alojados opcionales. Elige la
opción que corresponda con aquello que deseas operar.

| Tu objetivo                                                   | Opción recomendada                                                                                                                       |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Ejecutar un agente de escritorio privado con tu propio modelo | Usa el espacio **Local BYOK**. No requiere una cuenta de Wanta.                                                                          |
| Crear un agente de escritorio para tu producto                | Haz un fork de Wanta y personaliza el agente, herramientas, modelos, UI y marca.                                                         |
| Conectar tu propio despliegue de OpenConnector                | Hoy puedes compilar una distribución para un endpoint compatible. La configuración autogestionada dentro de la aplicación está prevista. |
| Usar modelos gestionados y conexiones SaaS autenticadas       | Inicia sesión en Wanta y utiliza los servicios alojados por OOMOL.                                                                       |
| Compartir conectores, Skills, acceso y uso con un equipo      | Usa un espacio de trabajo de equipo alojado de Wanta.                                                                                    |

### Modos de ejecución

| Modo                         | Cuenta necesaria          | Modelos                                              | Herramientas locales | Conectores      | Funciones de equipo         |
| ---------------------------- | ------------------------- | ---------------------------------------------------- | -------------------- | --------------- | --------------------------- |
| Local BYOK                   | No                        | Agente integrado + Provider compatible con OpenAI    | Sí                   | No disponibles  | No                          |
| Wanta alojado                | Sí                        | Integrado con OOMOL o BYOK; BYOA con cuentas nativas | Sí                   | OOMOL Connector | Sí                          |
| OpenConnector autogestionado | Previsto en la aplicación | Independiente de la selección de modelo y agente     | Sí                   | Previsto        | Definidas por el despliegue |

Las sesiones, proyectos y preferencias de modelos locales siguen disponibles después de cerrar sesión
o cuando caduca una sesión de OOMOL. Wanta no sube silenciosamente sesiones locales a un espacio de
trabajo de equipo de OOMOL.

La opción actual `WANTA_ENDPOINT` es una **configuración de distribución en tiempo de compilación**, no
un selector para el usuario durante la ejecución. Determina todo el entorno de servicios compatible,
no solo una URL base del conector. El flujo de URL base de aplicación y Runtime Token opcional para
OpenConnector autogestionado aparece como función futura y todavía no está completo.

## Personaliza y publica tu propio agente de escritorio

Wanta usa OpenCode como runtime fijado para el agente integrado y admite agentes externos mediante la
capa BYOA. El proceso principal controla el enrutamiento de sesiones y las capacidades portátiles del
host; cada adaptador conserva las capacidades nativas que realmente puede ofrecer.

### Motor del agente: OpenCode

La aplicación inicia el binario fijado `opencode-ai@1.18.21` como un sidecar `opencode serve` limitado
al loopback y lo controla con `@opencode-ai/sdk@1.18.21`. Los paquetes de OpenCode usan licencia MIT y
se reconocen en [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Wanta fija el runtime, el SDK y el
plugin a la misma versión exacta porque sus API no se consideran estables.

Los principales puntos de extensión son:

| Área                                             | Empieza aquí                                                         |
| ------------------------------------------------ | -------------------------------------------------------------------- |
| Identidad y contrato operativo del agente        | [`electron/agent/system-prompt.ts`](electron/agent/system-prompt.ts) |
| Modos, modelos, herramientas y permisos          | [`electron/agent/config.ts`](electron/agent/config.ts)               |
| Conectores y herramientas específicas de dominio | [`electron/agent/tool-sources.ts`](electron/agent/tool-sources.ts)   |
| Modelos integrados y personalizados              | [`electron/models/`](electron/models/)                               |
| Experiencia de chat y artefactos                 | [`src/routes/Chat/`](src/routes/Chat/)                               |
| Experiencia de conexiones                        | [`src/routes/Connections/`](src/routes/Connections/)                 |
| Identidad de la aplicación                       | [`electron/branding.ts`](electron/branding.ts)                       |

La capacidad del agente es un único contrato de producto expresado en tres lugares: herramientas
habilitadas, reglas de permisos e instrucciones del sistema. Modifícalos juntos para mantener alineados
el comportamiento, la seguridad y las expectativas de la UI. Lee la [guía de arquitectura](docs/architecture.md)
y las [convenciones de código](docs/conventions.md) antes de cambiar estos límites.

## Cómo funciona

```mermaid
flowchart TB
  User["Solicitud del usuario"] --> UI["Experiencia de escritorio Wanta"]
  UI --> BuiltIn["Agente integrado<br/>Runtime OpenCode"]
  UI --> BYOA["Claude Code · Codex · Grok<br/>Adaptadores BYOA"]
  BuiltIn --> Host["Capacidades del host Wanta"]
  BYOA --> Host
  Host --> Local["Archivos, shell, navegador, Skills y conocimiento"]
  Host --> Link["Actions gobernadas del Connector"]
  Link --> Hosted["Conector alojado por OOMOL"]
  Link -.-> SelfHosted["OpenConnector autogestionado<br/>configuración en la aplicación prevista"]
  Local --> Result["Resultados y artefactos de la tarea"]
  Hosted --> Result
  SelfHosted -.-> Result
  Result --> UI
```

Wanta evita registrar cientos de herramientas específicas de Providers en el contexto del modelo. Su
integración de conectores utiliza descubrimiento progresivo:

```text
listar aplicaciones conectadas → buscar una Action → inspeccionar su esquema → ejecutarla con parámetros validados
```

Así se mantiene pequeña la superficie de herramientas, se explicita el contrato de cada Action y los
errores de autorización regresan como estados estructurados del producto, no como texto libre del modelo.

### OpenCode, OpenConnector, Wanta y OOMOL

- **OpenCode** es el runtime fijado del agente integrado. Wanta gestiona su ciclo de vida y aporta
  modelos, configuración, permisos, instrucciones y herramientas personalizadas.
- **Claude Code, Codex y Grok** son runtimes BYOA. Conservan autenticación local, catálogos de modelos,
  cuotas y comportamiento nativos mientras reciben capacidades portátiles del host Wanta.
- **OpenConnector** es el proyecto hermano de código abierto para crear y ejecutar Providers en el
  ecosistema compartido de conectores.
- **Wanta** es el producto de agente de escritorio y la base de aplicación reutilizable de este repositorio.
- **OOMOL** proporciona la capa alojada opcional para inicio de sesión, modelos, credenciales de
  conectores, OAuth, equipos, Skills, uso, facturación y distribución.

El núcleo Local BYOK no requiere una cuenta de OOMOL. Iniciar sesión habilita los conectores alojados y
la capa de equipo; no es necesario para inspeccionar, bifurcar o desarrollar la aplicación de escritorio.

Consulta la [guía de arquitectura](docs/architecture.md) para conocer el diseño completo de procesos,
límites de confianza, IPC, streaming, autenticación y almacenamiento.

## Ejecutar desde el código fuente

Requisitos: Node.js 22.22.2 o posterior y pnpm mediante Corepack.

```bash
git clone https://github.com/oomol-lab/wanta.git
cd wanta
corepack pnpm install
corepack pnpm run dev
```

Esta es la ruta más corta para probar el repositorio. La configuración del entorno, los comandos de
prueba, la verificación del runtime, el empaquetado, la firma y los procesos de publicación están en la
[Guía de desarrollo](docs/development.md).

## Seguridad y límites de datos

- OpenCode solo escucha en loopback y usa una contraseña de servidor aleatoria por proceso.
- Los tokens de sesión de OOMOL y las claves de API de modelos personalizados tienen almacenamiento y ciclos de vida separados.
- Las claves de modelos se cifran con `safeStorage` de Electron y nunca se devuelven al renderer.
- Claude Code, Codex y Grok se autentican mediante sus propias CLI locales; Wanta no lee ni almacena sus credenciales sin procesar.
- Las credenciales de conectores permanecen en el entorno alojado o autogestionado elegido; el agente recibe resultados de acciones, no credenciales almacenadas de Providers.
- Las operaciones locales de alto riesgo están conectadas con la UI de aprobación explícita de Wanta.
- Las sesiones locales no se suben silenciosamente a un espacio de trabajo de equipo de OOMOL.

Consulta [SECURITY.md](SECURITY.md) para informar vulnerabilidades de forma privada y la
[guía de arquitectura](docs/architecture.md) para los límites de confianza completos.

## Mapa del proyecto

| Ruta                                       | Propósito                                                                |
| ------------------------------------------ | ------------------------------------------------------------------------ |
| [`electron/`](electron/)                   | Proceso principal, preload, runtime del agente y servicios de escritorio |
| [`src/`](src/)                             | Renderer de React, rutas, hooks y componentes de UI                      |
| [`scripts/`](scripts/)                     | Desarrollo, preparación de binarios, empaquetado y publicación           |
| [`resources/`](resources/)                 | Marca y recursos incluidos con la aplicación                             |
| [`docs/`](docs/)                           | Producto, arquitectura, desarrollo, convenciones y decisiones            |
| [`.github/workflows/`](.github/workflows/) | Automatización de pull requests y publicaciones                          |

La pila incluye Electron 42, Vite 8, React 19, Tailwind CSS 4, OpenCode, TypeScript, Vitest, oxlint y
oxfmt. Wanta se empaqueta para macOS, Windows y Linux.

## Documentación

- [Descripción del proyecto](docs/project-overview.md) — alcance del producto y relaciones del ecosistema
- [Arquitectura](docs/architecture.md) — procesos, runtime, IPC, streaming, autenticación y flujo de datos
- [Guía de desarrollo](docs/development.md) — instalación, ejecución, pruebas, empaquetado, firma y publicación
- [Convenciones de código](docs/conventions.md) — reglas de implementación y límites de seguridad
- [Decisiones técnicas clave](docs/key-decisions.md) — motivos de la arquitectura
- [Guía de contribución](CONTRIBUTING.md) — ramas, pull requests, verificación y normas de contribución
- [Política de seguridad](SECURITY.md) — comunicación privada de vulnerabilidades
- [Política de marcas](TRADEMARKS.md) y [avisos de terceros](THIRD_PARTY_NOTICES.md)

## Contribuir

Los issues y pull requests son bienvenidos. Antes de realizar un cambio importante de comportamiento
o interfaz, abre un issue para acordar primero la dirección y el alcance del producto. Lee
[CONTRIBUTING.md](CONTRIBUTING.md) antes de abrir un pull request; contiene el flujo de trabajo del
repositorio, las verificaciones necesarias y los límites de seguridad que deben preservar las contribuciones.

Al enviar una contribución, aceptas que se proporciona bajo la Licencia Apache, Versión 2.0, salvo que
indiques claramente lo contrario por escrito.

## Alcance de la licencia

Salvo indicación en contrario, el código fuente, los scripts, las pruebas y la documentación creados
para este repositorio se publican bajo la [Licencia Apache, Versión 2.0](LICENSE).

Esta licencia no concede derechos sobre productos, servicios, API, marcas, nombres comerciales,
logotipos, iconos, capturas de pantalla ni otros materiales de terceros que pertenecen a sus respectivos
titulares. Los nombres y materiales de terceros se utilizan únicamente para identificación e
interoperabilidad; su inclusión no implica respaldo, patrocinio ni asociación.
