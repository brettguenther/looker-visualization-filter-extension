// Copyright 2021 Google LLC

// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at

//     https://www.apache.org/licenses/LICENSE-2.0

// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import React, { useEffect, useState, useContext, useRef } from "react";
import {
  Space,
  ComponentsProvider,
  SpaceVertical,
  FieldSelectMulti,
  FieldSelect
} from "@looker/components";
import { getCore40SDK } from "@looker/extension-sdk-react";
import { getEmbedSDK } from "@looker/embed-sdk";
import { ExtensionContext40 } from "@looker/extension-sdk-react";
import styled from "styled-components";

const EmbedContainer = styled.div`
  width: 100%;
  height: 90vh;
  & > iframe {
    width: 100%;
    height: 100%;
  }
`;

const CenteredSpan = styled.span`
  width: 100%;
  height: 95vh;
  display: flex;
  justify-content: center;
  align-items: center;
`;

export const VizWithFilter = () => {
  const coreSDK = getCore40SDK();
  const {
    visualizationData,
    lookerHostData,
    visualizationSDK,
    tileHostData,
    extensionSDK,
  } = useContext(ExtensionContext40);
  const embedInitialized = useRef(false);
  const configInitialized = useRef(false);
  const [connection, setConnection] = useState(null);
  const [query, setQuery] = useState(null);
  const [filterSelection, setFilterSelection] = useState([]);
  const [hostname, setHostname] = useState(null);
  const [filterOptions, setFilterOptions] = useState([]);
  const [filterDefault, setFilterDefault] = useState(null);
  const [pdfImageSrc, setPdfImageSrc] = useState(null);

  const { dashboardFilters } = tileHostData;

  // Configuration options
  const vizDefaultConfig = {
    queryId: {
      label: "Query Id Source",
      type: "string",
    },
    filterFieldReference: {
      label: "Filter Field Reference",
      type: "string",
    },
    modelFilterField: {
      label: "Model Filter Field Reference",
      type: "string",
    }
    // ,defaultFilterValue: {
    //   label: "Default Filter Value",
    //   type: "string",
    // }
  };

  // Filter options for the multi-select
  const fetchFilterOptions = async (modelName, viewName, fieldName) => {
    try {
      if (!viewName || !modelName || !fieldName) {
        console.log(
          "Missing required configuration to fetch filter options: queryId, modelFilterField or filterFieldReference"
        );
        return;
      }
      const fieldSuggestions = await coreSDK.ok(
        coreSDK.model_fieldname_suggestions({
          model_name: modelName,
          view_name: viewName,
          field_name: fieldName,
        })
      );

      if (!fieldSuggestions || !fieldSuggestions.suggestions) {
        console.log("No suggestions returned from API");
        setFilterOptions([]);
        return;
      }
      // Transform suggestions into the format expected by FieldSelectMulti
      const options = fieldSuggestions.suggestions
        .filter((suggestion) => suggestion != null)
        .map((suggestion) => ({
          value: String(suggestion),
          label: String(suggestion),
        }));

      setFilterOptions(options);
    } catch (error) {
      console.error("Error fetching filter options:", error);
      setFilterOptions([]);
    }
  };

  // Handle visualization configuration changes
  useEffect(() => {
    if (!hostname || lookerHostData?.isRendering) return;

    console.log(`Looker VisConfig Effect`);
    const visConfig = visualizationData?.visConfig;
    console.log(`Current visConfig:`, JSON.stringify(visConfig));

    if (!configInitialized.current) {
      console.log("setting default config");
      visualizationSDK.configureVisualization(vizDefaultConfig);
      visualizationSDK.setVisConfig({
        queryId: visConfig?.queryId,
        filterFieldReference: visConfig?.filterFieldReference,
        modelFilterField: visConfig?.modelFilterField,
        dashboardFilters: visConfig?.dashboardFilters,
      });
      configInitialized.current = true;
    }

    if (
      !visConfig ||
      !visConfig?.queryId ||
      !visConfig?.filterFieldReference ||
      !visConfig?.modelFilterField
    ) {
      console.log(
        "Missing required configuration: queryId, modelFilterField or filterFieldReference"
      );
      return;
    }

    const initializeQuery = async () => {
      try {
        console.log(`Attempting to fetch query with ID: ${visConfig.queryId}`);
        const queryInit = await coreSDK.ok(coreSDK.query(visConfig.queryId));
        console.log(`Successfully fetched query:`, queryInit);

        const queryFiltered = {};

        const allowedKeys = [
          "model",
          "view",
          "fields",
          "pivots",
          "fill_fields",
          "filters",
          "filter_expression",
          "sorts",
          "limit",
          "column_limit",
          "total",
          "row_total",
          "subtotals",
          "vis_config",
          "filter_config",
          "visible_ui_sections",
          "dynamic_fields",
          "query_timezone",
        ];

        for (const key of allowedKeys) {
          if (Object.prototype.hasOwnProperty.call(queryInit, key)) {
            queryFiltered[key] = queryInit[key];
          }
        }

        // Get dashboard filters if available
        let dashboardFiltersListen = {};
        if (tileHostData?.elementId) {
          const cDashboardElement = await coreSDK.ok(
            coreSDK.dashboard_element(tileHostData?.elementId)
          );
          const filterables = cDashboardElement.result_maker.filterables;

          if (filterables && filterables.length > 0 && dashboardFilters) {
            console.log(`Applying dashboard filters: ${JSON.stringify(dashboardFilters)}`);
            
            filterables.forEach(filterable => {
              if (filterable.listen && filterable.listen.length > 0) {
                filterable.listen.forEach(listenObj => {
                  const dashboardFilterName = listenObj.dashboard_filter_name;
                  const field = listenObj.field;
                  
                  if (dashboardFilters[dashboardFilterName] !== undefined) {
                    console.log(
                      `Mapping dashboard filter "${dashboardFilterName}" to field "${field}" with value "${dashboardFilters[dashboardFilterName]}"`
                    );
                    dashboardFiltersListen[field] = dashboardFilters[dashboardFilterName];
                  }
                });
              }
            });
          }
        }

        // Create new query with combined filters
        const queryBody = {
          ...queryFiltered,
          filters: {
            ...queryInit.filters,
            ...dashboardFiltersListen
          }
        };

        const newQuery = await coreSDK.ok(coreSDK.create_query(queryBody));
        setQuery(newQuery);

        // Extract model, view, and field from filterFieldReference
        const model = visConfig.modelFilterField;
        const view = visConfig?.filterFieldReference.split(".")[0];
        if (model && view) {
          console.log(
            `Fetching filter options for model: ${model}, view: ${view}, field: ${visConfig?.filterFieldReference}`
          );
          await fetchFilterOptions(
            model,
            view,
            visConfig?.filterFieldReference
          );
        }
      } catch (error) {
        console.error("Error initializing query:", error);
        console.error("Error details:", {
          queryId: visConfig.queryId,
          errorType: error.type,
          errorMessage: error.message,
        });
        setQuery(null);
      }
    };

    initializeQuery();
  }, [visualizationData?.visConfig]);

  // rendering done when connection is set to support PDF downloads
  // useEffect(() => {
  //   if (visualizationData) {
  //     extensionSDK.rendered();
  //   }
  // }, [connection]);
  
  useEffect(() => {
    let objectUrl = null; // To keep track of blob URL created in this effect run

    const handlePdfRender = async () => {
      console.log("Handling render new")
      // todo: use the query object here, not the visConfig
      if (lookerHostData?.isRendering && coreSDK && visualizationData?.visConfig) {
        try {
          // console.log("Attempting to render PDF image for query:", query.id);
          const imageQueryResult = await coreSDK.ok(
            // coreSDK.run_query({ query_id: "dd9PokcTAN2l0KZYiCvOpw", result_format: "png" })
            coreSDK.run_query({ query_id: visualizationData?.visConfig?.queryId, result_format: "png" })
          );

          console.log(imageQueryResult);
          // console.log(imageQueryResult.body);
          // console.log(imageQueryResult.contentType);
          
          let imageSrcValue;
          if (imageQueryResult instanceof Blob) {
            objectUrl = URL.createObjectURL(imageQueryResult); // Store for cleanup
            imageSrcValue = objectUrl.toString();
          } else {
            imageSrcValue = `data:${imageQueryResult.contentType};base64,${btoa(
              imageQueryResult.body
            )}`;
          }
          setPdfImageSrc(imageSrcValue);
          extensionSDK.rendered();
          console.log("PDF image rendered, src set.");
        } catch (error) {
          console.error("Error generating image for PDF:", error);
          setPdfImageSrc(null); 
          extensionSDK.rendered();
        }
      } 
      // else {
      //   // If not rendering PDF, or query/coreSDK not available, ensure pdfImageSrc is null
      //   if (pdfImageSrc !== null) { 
      //       setPdfImageSrc(null);
      //       console.log("Exiting PDF render mode or missing query/sdk, clearing image src.");
      //   }
      // }
    };

    handlePdfRender();

    return () => {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
        console.log("Revoked object URL:", objectUrl);
      }
    }
  }, [visualizationData?.visConfig]); // pdfImageSrc added to ensure cleanup if it changes externally, though primarily driven by other deps.

  // Initialize Embed SDK with hostname
  useEffect(() => {
    console.log(`lookerHostData effect`);
    if (lookerHostData?.isRendering) return;
    if (lookerHostData?.hostUrl) {
      try {
        const url = new URL(lookerHostData.hostUrl);
        const extractedHostname = url.hostname;
        console.log(`Initializing Embed SDK with host: ${extractedHostname}`);
        getEmbedSDK().init(extractedHostname);
        setHostname(extractedHostname);
      } catch (error) {
        console.error(
          "Error parsing hostUrl or initializing Embed SDK:",
          error
        );
      }
    }
  }, [lookerHostData]);

  // Handle filter selection changes
  useEffect(() => {
    console.log(`Looker Filter Effect`);
    const updateQueryWithFilters = async () => {
      if (!query?.id || !visualizationData?.visConfig?.filterFieldReference)
        return;
      try {
        const queryInit = await coreSDK.ok(coreSDK.query(query.id));

        const queryBody = {};

        const allowedKeys = [
          "model",
          "view",
          "fields",
          "pivots",
          "fill_fields",
          "filters",
          "filter_expression",
          "sorts",
          "limit",
          "column_limit",
          "total",
          "row_total",
          "subtotals",
          "vis_config",
          "filter_config",
          "visible_ui_sections",
          "dynamic_fields",
          "query_timezone",
        ];

        for (const key of allowedKeys) {
          if (Object.prototype.hasOwnProperty.call(queryInit, key)) {
            queryBody[key] = queryInit[key];
          }
        }

        // Start with existing filters from queryInit
        const existingFilters = queryInit.filters || {};
        const combinedFilters = { ...existingFilters };

        // Add/update filter selection
        if (filterSelection && filterSelection.length > 0) {
          const filterValues = filterSelection.join(",");
          console.log(`Applying filter values: ${filterValues}`);
          combinedFilters[visualizationData?.visConfig?.filterFieldReference] =
            filterValues;
        } else {
          delete combinedFilters[
            visualizationData?.visConfig?.filterFieldReference
          ];
        }

        queryBody.filters = combinedFilters;

        const newQuery = await coreSDK.ok(coreSDK.create_query(queryBody));
        setQuery(newQuery);

        if (connection) {
          connection.loadQueryVisualization(newQuery.id);
        }
      } catch (error) {
        console.error("Error updating query with filters:", error);
      }
    };

    updateQueryWithFilters();
  }, [filterSelection, visConfig?.filterFieldReference]);

  // dashboardFilters effect
  useEffect(() => {
    console.log(`Dashboard Filter Effect`);
    const updateWithDashboardFilters = async () => {
      try {
        if (!dashboardFilters) return;
        if (!tileHostData?.elementId) return;

        const cDashboardElement = await coreSDK.ok(
          coreSDK.dashboard_element(tileHostData?.elementId)
        );

        const filterables = cDashboardElement.result_maker.filterables;

        const dashboardFiltersListen = {};

        if (filterables && filterables.length > 0 && dashboardFilters) {
          console.log(`Applying dashboard filters: ${JSON.stringify(dashboardFilters)}`);
          
          // Iterate through each filterable object
          filterables.forEach(filterable => {
            if (filterable.listen && filterable.listen.length > 0) {
              // Check each listen object in the filterable
              filterable.listen.forEach(listenObj => {
                const dashboardFilterName = listenObj.dashboard_filter_name;
                const field = listenObj.field;
                
                if (dashboardFilters[dashboardFilterName] !== undefined) {
                  console.log(
                    `Mapping dashboard filter "${dashboardFilterName}" to field "${field}" with value "${dashboardFilters[dashboardFilterName]}"`
                  );
                  dashboardFiltersListen[field] = dashboardFilters[dashboardFilterName];
                }
              });
            }
          });
        }
      } catch (error) {
        console.error("Error updating query with dashboard filters:", error);
      }
    };
    updateWithDashboardFilters();
  }, [dashboardFilters]);

  // Handle embedding the visualization
  useEffect(() => {
    console.log(`Looker Query Effect`);
    if (!hostname || !query?.id || lookerHostData?.isRendering) return;

    const embedVisualization = async (queryId) => {
      try {
        embedInitialized.current = true;
        // Clear previous embeds
        const embedContainer = document.getElementById("looker-embed");
        if (embedContainer) {
          embedContainer.innerHTML = "";
        }
        const embed = getEmbedSDK()
          .createQueryVisualizationWithId(queryId)
          .appendTo("#looker-embed")
          .withFrameBorder("0")
          .withDynamicIFrameHeight()
          .build()
          .connect()
          .then((conn) => {
            setConnection(conn);
          })
          .catch((error) => {
            console.error("Error connecting to visualization:", error);
            embedInitialized.current = false;
          });
      } catch (error) {
        console.error("Error embedding visualization:", error);
        embedInitialized.current = false;
      }
    };

    if (connection) {
      connection.loadQueryVisualization(query.id);
    } else {
      embedVisualization(query.id);
    }
  }, [query]);

  useEffect(() => {
    if (visConfig?.defaultFilterValue) {
      setFilterDefault(visConfig?.defaultFilterValue)
    }
  }, [visConfig?.defaultFilterValue]);

  const visConfig = visualizationData?.visConfig;
  const hasRequiredConfig =
    visConfig?.queryId &&
    visConfig?.filterFieldReference &&
    visConfig?.modelFilterField;
    // && visConfig?.defaultFilterValue;

  // TO DO: make the filter type dynamic
  return (
    <ComponentsProvider>
      <SpaceVertical gap="none">
        <Space>
          {hasRequiredConfig ? (
            <FieldSelectMulti
              options={filterOptions}
              onChange={setFilterSelection}
              autoResize={true}
              id="field-filter"
            />
            // <FieldSelect
            //   name="t2" 
            //   label="t2"
            //   // defaultValue={filterDefault}
            //   options={filterOptions}
            //   onChange={setFilterSelection}
            //   />
          ) : (
            <CenteredSpan>
              Please configure a Query ID, Model and Filter Field Reference in
              the visualization settings
            </CenteredSpan>
          )}
        </Space>
        {pdfImageSrc ? (
          <img 
            src={pdfImageSrc} 
            alt="Visualization Render" 
            style={{ width: '100%', height: '90vh', objectFit: 'contain' }} 
          />
        ) : (
          <EmbedContainer id="looker-embed"></EmbedContainer>
        )}
      </SpaceVertical>
    </ComponentsProvider>
  );
};
