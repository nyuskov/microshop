function readPackage(pkg, context) {
  // Разрешаем скрипты сборки для конкретных пакетов, вызывающих ошибку
  if (pkg.name === '@parcel/watcher' || pkg.name === 'esbuild' || pkg.name === 'vue-demi') {
    // Удаляем скрипты сборки, если они есть, или позволяем им выполняться
    // Для простоты, удалим их. В продакшене лучше явно указывать разрешенные команды.
    if (pkg.scripts && pkg.scripts.install) {
      console.log(`Allowing install script for ${pkg.name}`)
    }
    if (pkg.scripts && pkg.scripts.preinstall) {
      console.log(`Allowing preinstall script for ${pkg.name}`)
    }
    if (pkg.scripts && pkg.scripts.postinstall) {
      console.log(`Allowing postinstall script for ${pkg.name}`)
    }
  }
  return pkg
}

module.exports = {
  hooks: {
    readPackage
  }
}
