// Copyright 2021 The Board of Trustees of the Leland Stanford Junior University
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
package dbproxy

import (
	"almond-cloud/sql"
	"flag"
	"fmt"
	"os"

	"github.com/gin-gonic/gin"
)

var (
	flagSet = flag.NewFlagSet("dbproxy", flag.ExitOnError)
	port    = flagSet.Int("port", 8888, "port")
)

func Usage() {
	fmt.Printf("Usage of %s dbproxy", os.Args[0])
	flagSet.PrintDefaults()
}

func Run(args []string) {

	flagSet.Parse(args)
	fmt.Printf("--- port:%v", *port)
	dsn := "newuser:password@tcp(127.0.0.1:3306)/dbname?charset=utf8mb4&parseTime=True&loc=Local"
	sql.InitMySQL(dsn)
	r := gin.Default()

	r.GET("/localtable/:name/:userid", localTableGetAll)
	r.GET("/localtable/:name/:userid/:uniqueid", localTableGetOne)
	r.DELETE("/localtable/:name/:userid/:uniqueid", localTableDeleteOne)
	r.POST("/localtable/:name/:userid", localTableInsertOne)

	r.GET("/synctable/:name/:userid", syncTableGetAll)
	r.GET("/synctable/:name/:userid/:uniqueid", syncTableGetOne)
	r.GET("/synctable/raw/:name/:userid", syncTableGetRaw)
	r.GET("/synctable/changes/:name/:userid/:millis", syncTableGetChangesAfter)
	r.POST("/synctable/changes/:name/:userid", syncTableHandleChanges)
	r.POST("/synctable/sync/:name/:userid/:millis", syncTableSyncAt)
	r.POST("/synctable/replace/:name/:userid", syncTableReplaceAll)
	r.POST("/synctable/:name/:userid/:millis", syncTableInsertIfRecent)
	r.POST("/synctable/:name/:userid", syncTableInsertOne)
	r.DELETE("/synctable/:name/:userid/:uniqueid/:millis", syncTableDeleteIfRecent)
	r.DELETE("/synctable/:name/:userid/:uniqueid", syncTableDeleteOne)
	r.Run(fmt.Sprintf("0.0.0.0:%d", *port))
}
